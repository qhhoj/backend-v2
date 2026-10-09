import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { SubmissionCase, SubmissionStatus } from '@libs/database';
import {
  gradedJobId,
  notifyGraded,
  SUBMISSION_GRADED_QUEUE,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionEventType, SubmissionGradedJob } from '@libs/judging';
import type { AssignmentRef } from '@libs/judge-proto';
import type { QueuedSubmission } from '../dispatch/slots';
import type { FinalReport } from '../link/messages';
import type { AssignRequest } from './assign-request';
import { RunWritesRepository } from './run-writes.repository';
import type { RetryOutcome } from './run-writes.repository';
import { SubmissionsRepository } from './submissions.repository';
import type { RunKey, WriteOutcome } from './write-outcome';

export const LOST_JUDGE_MESSAGE =
  'The judge disconnected twice while grading this submission';
/** Test-case events per submission: at most one per interval (4/s; legacy allowed 5 per 0.5 s). */
export const PROGRESS_EVENT_INTERVAL_MS = 250;

/** A claimed run and whom its events name; `sent` starts tracking once the judge really got it. */
export interface Claimed {
  request: AssignRequest;
  subject: SubmissionGradedJob;
}

/** How a run whose judge stayed away past the grace ended. */
export type GraceOutcome = 'requeued' | 'failed' | 'aborted' | 'stale';

interface Tracked {
  subject: SubmissionGradedJob;
  /** The run being tracked: `forget` of an older generation leaves a newer one alone. */
  generation: number;
  progressAt: number;
}

const FINAL_STATUS = {
  'compile-error': 'CE',
  'internal-error': 'IE',
  aborted: 'AB',
} as const;

/** What each judge message does to its run, and the claim, release and grace transitions around it. A finished submission (D, CE, IE, AB) enqueues one `submission-graded` job, named by its run; every status change written is published as a submission event. */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  /** Claimed submissions: whom their events name and when progress was last published; dropped when they finish or go back to the queue. */
  private readonly tracked = new Map<string, Tracked>();

  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly writes: RunWritesRepository,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
    private readonly events: SubmissionEventsService,
  ) {}

  /** The claim for `judgeName`, or null when the row is no longer queued or lost its data (finished as IE, graded job enqueued). A claim that throws (Mongo down) is logged; if the row was already P, no session holds it and the resync returns it to the queue within two ticks. */
  async claim(
    queued: QueuedSubmission,
    judgeName: string,
  ): Promise<Claimed | null> {
    let outcome: Awaited<ReturnType<SubmissionsRepository['claimRun']>>;
    try {
      outcome = await this.submissions.claimRun(queued, judgeName);
    } catch (error) {
      this.logger.error(
        `Claiming submission ${queued.id} failed: ${(error as Error).message}`,
      );
      return null;
    }
    if (outcome && 'failed' in outcome)
      await this.finished(outcome.failed, 'IE', null);
    return outcome && 'request' in outcome ? outcome : null;
  }

  /** The Assign is about to reach the judge: events start here, so a judge that vanished mid-claim leaves no `processing` behind. */
  sent({ subject, request }: Claimed): void {
    const { generation } = request.ref;
    this.tracked.set(subject.submissionId, {
      subject,
      generation,
      progressAt: 0,
    });
    this.publish(subject, 'processing', 'P');
  }

  /** The bridge let go of the run (wound down or dropped) and will not see it end: its events stop here. */
  forget(ref: AssignmentRef): void {
    if (this.tracked.get(ref.submissionId)?.generation === ref.generation)
      this.tracked.delete(ref.submissionId);
  }

  /** The judge never accepted the run (or vanished before it was sent): back to the queue without spending the requeue. */
  async release(ref: AssignmentRef, judgeName: string): Promise<boolean> {
    const released = await this.submissions.releaseRun(ref, judgeName);
    if (released) this.requeued(ref.submissionId);
    return released;
  }

  /** Rows a resync returned to the queue (no judge loss). */
  announceRequeued(subjects: SubmissionGradedJob[]): void {
    for (const subject of subjects) {
      this.tracked.delete(subject.submissionId);
      this.publish(subject, 'queued', 'QU');
    }
  }

  resumableSeq(ref: AssignmentRef, judgeName: string): Promise<number | null> {
    return this.submissions.resumableSeq(ref, judgeName);
  }

  accepted(key: RunKey): Promise<WriteOutcome> {
    return this.writes.accept(key);
  }

  compiled(key: RunKey, log: string): Promise<WriteOutcome> {
    return this.writes.compiled(key, log);
  }

  async started(key: RunKey, isPretested: boolean): Promise<WriteOutcome> {
    const outcome = await this.writes.started(key, isPretested);
    if (outcome === 'applied')
      this.publishTracked(key.ref.submissionId, 'grading-begin', 'G');
    return outcome;
  }

  /** Progress is published for appended cases only, at most once per `PROGRESS_EVENT_INTERVAL_MS`; `done` is never throttled. */
  async cases(key: RunKey, cases: SubmissionCase[]): Promise<WriteOutcome> {
    const outcome = await this.writes.cases(key, cases);
    const tracked = this.tracked.get(key.ref.submissionId);
    const now = Date.now();
    if (
      outcome === 'applied' &&
      cases.length &&
      tracked &&
      now - tracked.progressAt >= PROGRESS_EVENT_INTERVAL_MS
    ) {
      tracked.progressAt = now;
      const next = Math.max(...cases.map((row) => row.position)) + 1;
      this.publish(tracked.subject, 'test-case', 'G', next);
    }
    return outcome;
  }

  /** The run's last message. Acked only after the write and the graded job, so a bridge crash in between makes the judge resend it: the duplicate re-enqueues the same job id, which BullMQ drops while the first still waits. */
  async final(key: RunKey, report: FinalReport): Promise<WriteOutcome> {
    const { kind } = report;
    if (kind === 'retry') return this.retried(key, report.log);
    const written =
      kind === 'graded'
        ? await this.writes.finishGraded(key, report.dataVersionUsed)
        : await this.writes.finishWith(key, FINAL_STATUS[kind], report);
    if (written.outcome === 'applied')
      await this.finished(
        written.job,
        kind === 'graded' ? 'D' : FINAL_STATUS[kind],
        key.ref.generation,
      );
    if (written.outcome === 'duplicate') await this.renotify(key);
    return written.outcome;
  }

  /** The judge stayed away past the grace: an abort recorded meanwhile ends it as AB; otherwise requeued once, IE the second time. */
  async graceExpired(
    ref: AssignmentRef,
    judgeName: string,
    abortRequested: boolean,
  ): Promise<GraceOutcome> {
    if (abortRequested) {
      const job = await this.submissions.finishRun(ref, judgeName, 'AB', null);
      await this.finished(job, 'AB', ref.generation);
      return job ? 'aborted' : 'stale';
    }
    if (await this.submissions.requeueRun(ref, judgeName)) {
      this.requeued(ref.submissionId);
      return 'requeued';
    }
    const failed = await this.submissions.finishRun(
      ref,
      judgeName,
      'IE',
      LOST_JUDGE_MESSAGE,
    );
    await this.finished(failed, 'IE', ref.generation);
    return failed ? 'failed' : 'stale';
  }

  /** Claimed submissions still tracked for events. */
  trackedCount(): number {
    return this.tracked.size;
  }

  private async retried(key: RunKey, log: string): Promise<WriteOutcome> {
    const written: RetryOutcome = await this.writes.retry(key, log);
    if (written.outcome !== 'applied') return written.outcome;
    if (written.requeued) this.requeued(key.ref.submissionId);
    else await this.finished(written.job, 'IE', key.ref.generation);
    return written.outcome;
  }

  private async renotify(key: RunKey): Promise<void> {
    const subject = await this.submissions.gradedSubjectOf(
      key.ref.submissionId,
    );
    await notifyGraded(
      this.graded,
      subject,
      this.logger,
      gradedJobId(key.ref.submissionId, key.ref.generation),
    );
  }

  private requeued(submissionId: string): void {
    const tracked = this.tracked.get(submissionId);
    this.tracked.delete(submissionId);
    if (tracked) this.publish(tracked.subject, 'queued', 'QU');
  }

  /** The graded job first (effects), then the `done` event; `generation` names the job (null: no run, the claim itself failed). */
  private async finished(
    job: SubmissionGradedJob | null,
    status: SubmissionStatus,
    generation: number | null,
  ): Promise<void> {
    if (!job) return;
    this.tracked.delete(job.submissionId);
    const jobId =
      generation === null
        ? undefined
        : gradedJobId(job.submissionId, generation);
    await notifyGraded(this.graded, job, this.logger, jobId);
    this.publish(job, 'done', status);
  }

  private publishTracked(
    submissionId: string,
    type: SubmissionEventType,
    status: SubmissionStatus,
  ): void {
    const tracked = this.tracked.get(submissionId);
    if (tracked) this.publish(tracked.subject, type, status);
  }

  /** Never awaited: a Redis stall must not hold up judge messages. One session handles one message at a time, so events of a submission cannot reorder. */
  private publish(
    subject: SubmissionGradedJob,
    type: SubmissionEventType,
    status: SubmissionStatus,
    currentTestcase = 0,
  ): void {
    this.events
      .publish(submissionEvent(subject, type, status, currentTestcase))
      .catch((error: Error) =>
        this.logger.error(`Event ${type} not published: ${error.message}`),
      );
  }
}
