import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { SubmissionCase, SubmissionStatus } from '@libs/database';
import type { QueuedSubmission } from '../dispatch/dispatch';
import type { SubmissionRequest } from '../protocol/judge-packets';
import {
  notifyGraded,
  SUBMISSION_GRADED_QUEUE,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionEventType, SubmissionGradedJob } from '@libs/judging';
import { SubmissionsRepository } from './submissions.repository';
import type { CasesOutcome } from './submissions.repository';

export type DisconnectOutcome = 'requeued' | 'failed' | 'stale';
export const LOST_JUDGE_MESSAGE =
  'The judge disconnected twice while grading this submission';
/** Test-case events per submission: at most one per interval (4/s; legacy allowed 5 per 0.5 s). */
export const PROGRESS_EVENT_INTERVAL_MS = 250;

interface Tracked {
  subject: SubmissionGradedJob;
  progressAt: number;
}

/** What each judge packet does to its submission; a finished submission (D, CE, IE, AB) enqueues one `submission-graded` job. Every status change that was written is published as a submission event. */
@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);
  /** Claimed submissions: whom their events name and when progress was last published; dropped when they finish or go back to the queue. */
  private readonly tracked = new Map<string, Tracked>();

  constructor(
    private readonly submissions: SubmissionsRepository,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
    private readonly events: SubmissionEventsService,
  ) {}

  /** The request for `judgeName`, or null when the submission is no longer queued or lost its data (finished as IE, graded job enqueued). */
  async claim(
    queued: QueuedSubmission,
    judgeName: string,
  ): Promise<SubmissionRequest | null> {
    let outcome: Awaited<ReturnType<SubmissionsRepository['claim']>>;
    try {
      outcome = await this.submissions.claim(queued, judgeName);
    } catch (error) {
      this.logger.error(
        `Claiming submission ${queued.id} failed, back to the queue: ${(error as Error).message}`,
      );
      await this.release(queued.id, judgeName);
      return null;
    }
    if (outcome && 'failed' in outcome)
      await this.finished(outcome.failed, 'IE');
    if (!outcome || !('request' in outcome)) return null;
    this.tracked.set(queued.id, { subject: outcome.subject, progressAt: 0 });
    await this.publish(outcome.subject, 'processing', 'P');
    return outcome.request;
  }

  /** The judge vanished between the claim and the request: back to the queue without spending the requeue. */
  async release(submissionId: string, judgeName: string): Promise<boolean> {
    const tracked = this.tracked.get(submissionId);
    const released = await this.submissions.release(submissionId, judgeName);
    if (released) {
      this.tracked.delete(submissionId);
      if (tracked) await this.publish(tracked.subject, 'queued', 'QU');
    }
    return released;
  }

  /** Rows a start or a resync returned to the queue (no judge loss). */
  async announceRequeued(subjects: SubmissionGradedJob[]): Promise<void> {
    for (const { submissionId } of subjects) this.tracked.delete(submissionId);
    await Promise.all(
      subjects.map((subject) => this.publish(subject, 'queued', 'QU')),
    );
  }

  async beginGrading(
    submissionId: string,
    judgeName: string,
    pretested: boolean,
  ): Promise<void> {
    if (await this.submissions.beginGrading(submissionId, judgeName, pretested))
      await this.publishTracked(submissionId, 'grading-begin', 'G');
  }

  markBatched(submissionId: string, judgeName: string): Promise<void> {
    return this.submissions.markBatched(submissionId, judgeName);
  }

  /** Progress is published for appended cases only, at most once per `PROGRESS_EVENT_INTERVAL_MS`; `done` is never throttled. */
  async addCases(
    submissionId: string,
    judgeName: string,
    cases: SubmissionCase[],
  ): Promise<CasesOutcome> {
    const outcome = await this.submissions.appendCases(
      submissionId,
      judgeName,
      cases,
    );
    const tracked = this.tracked.get(submissionId);
    const now = Date.now();
    if (
      outcome === 'appended' &&
      tracked &&
      now - tracked.progressAt >= PROGRESS_EVENT_INTERVAL_MS
    ) {
      tracked.progressAt = now;
      await this.publish(
        tracked.subject,
        'test-case',
        'G',
        Math.max(...cases.map((testCase) => testCase.position)) + 1,
      );
    }
    return outcome;
  }

  compileMessage(
    submissionId: string,
    judgeName: string,
    log: string,
  ): Promise<void> {
    return this.submissions.setCompileMessage(submissionId, judgeName, log);
  }

  async gradingEnd(submissionId: string, judgeName: string): Promise<void> {
    await this.finished(
      await this.submissions.finishGrading(submissionId, judgeName),
      'D',
    );
  }

  async compileError(
    submissionId: string,
    judgeName: string,
    log: string,
  ): Promise<void> {
    await this.finished(
      await this.submissions.finishWith(submissionId, judgeName, 'CE', log),
      'CE',
    );
  }

  async internalError(
    submissionId: string,
    judgeName: string,
    message: string,
  ): Promise<void> {
    await this.finished(
      await this.submissions.finishWith(submissionId, judgeName, 'IE', message),
      'IE',
    );
  }

  async terminated(submissionId: string, judgeName: string): Promise<void> {
    await this.finished(
      await this.submissions.finishWith(submissionId, judgeName, 'AB', null),
      'AB',
    );
  }

  /** The judge's connection closed while `submissionId` was in flight: requeued once, an internal error the second time. */
  async disconnected(
    submissionId: string,
    judgeName: string,
  ): Promise<DisconnectOutcome> {
    const tracked = this.tracked.get(submissionId);
    if (await this.submissions.requeue(submissionId, judgeName)) {
      this.tracked.delete(submissionId);
      if (tracked) await this.publish(tracked.subject, 'queued', 'QU');
      return 'requeued';
    }
    const failed = await this.submissions.finishWith(
      submissionId,
      judgeName,
      'IE',
      LOST_JUDGE_MESSAGE,
    );
    await this.finished(failed, 'IE');
    return failed ? 'failed' : 'stale';
  }

  /** Claimed submissions still tracked for events. */
  trackedCount(): number {
    return this.tracked.size;
  }

  /** The graded job first (effects), then the `done` event. */
  private async finished(
    job: SubmissionGradedJob | null,
    status: SubmissionStatus,
  ): Promise<void> {
    if (!job) return;
    this.tracked.delete(job.submissionId);
    await notifyGraded(this.graded, job, this.logger);
    await this.publish(job, 'done', status);
  }

  private async publishTracked(
    submissionId: string,
    type: SubmissionEventType,
    status: SubmissionStatus,
  ): Promise<void> {
    const tracked = this.tracked.get(submissionId);
    if (tracked) await this.publish(tracked.subject, type, status);
  }

  private publish(
    subject: SubmissionGradedJob,
    type: SubmissionEventType,
    status: SubmissionStatus,
    currentTestcase = 0,
  ): Promise<void> {
    return this.events.publish(
      submissionEvent(subject, type, status, currentTestcase),
    );
  }
}
