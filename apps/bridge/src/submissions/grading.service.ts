import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { SubmissionCase } from '@libs/database';
import type { QueuedSubmission } from '../dispatch/dispatch';
import type { SubmissionRequest } from '../protocol/judge-packets';
import {
  enqueueGraded,
  SUBMISSION_GRADED_QUEUE,
  withinTimeout,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionsRepository } from './submissions.repository';
import type { CasesOutcome } from './submissions.repository';

/** Longest a finishing packet waits for its graded job to reach Redis; the verdict is already in Mongo. */
export const ENQUEUE_TIMEOUT_MS = 1000;
export type DisconnectOutcome = 'requeued' | 'failed' | 'stale';
export const LOST_JUDGE_MESSAGE =
  'The judge disconnected twice while grading this submission';

/** What each judge packet does to its submission; a finished submission (D, CE, IE, AB) enqueues one `submission-graded` job. */
@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly submissions: SubmissionsRepository,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
  ) {}

  /** The request for `judgeName`, or null when the submission is no longer queued or lost its data (finished as IE, graded job enqueued). */
  async claim(
    queued: QueuedSubmission,
    judgeName: string,
  ): Promise<SubmissionRequest | null> {
    const outcome = await this.submissions.claim(queued, judgeName);
    if (outcome && 'failed' in outcome) await this.notify(outcome.failed);
    return outcome && 'request' in outcome ? outcome.request : null;
  }

  async beginGrading(
    submissionId: string,
    judgeName: string,
    pretested: boolean,
  ): Promise<void> {
    await this.submissions.beginGrading(submissionId, judgeName, pretested);
  }

  markBatched(submissionId: string, judgeName: string): Promise<void> {
    return this.submissions.markBatched(submissionId, judgeName);
  }

  addCases(
    submissionId: string,
    judgeName: string,
    cases: SubmissionCase[],
  ): Promise<CasesOutcome> {
    return this.submissions.appendCases(submissionId, judgeName, cases);
  }

  compileMessage(
    submissionId: string,
    judgeName: string,
    log: string,
  ): Promise<void> {
    return this.submissions.setCompileMessage(submissionId, judgeName, log);
  }

  async gradingEnd(submissionId: string, judgeName: string): Promise<void> {
    await this.notify(
      await this.submissions.finishGrading(submissionId, judgeName),
    );
  }

  async compileError(
    submissionId: string,
    judgeName: string,
    log: string,
  ): Promise<void> {
    await this.notify(
      await this.submissions.finishWith(submissionId, judgeName, 'CE', log),
    );
  }

  async internalError(
    submissionId: string,
    judgeName: string,
    message: string,
  ): Promise<void> {
    await this.notify(
      await this.submissions.finishWith(submissionId, judgeName, 'IE', message),
    );
  }

  async terminated(submissionId: string, judgeName: string): Promise<void> {
    await this.notify(
      await this.submissions.finishWith(submissionId, judgeName, 'AB', null),
    );
  }

  /** The judge's connection closed while `submissionId` was in flight: requeued once, an internal error the second time. */
  async disconnected(
    submissionId: string,
    judgeName: string,
  ): Promise<DisconnectOutcome> {
    if (await this.submissions.requeue(submissionId, judgeName))
      return 'requeued';
    const failed = await this.submissions.finishWith(
      submissionId,
      judgeName,
      'IE',
      LOST_JUDGE_MESSAGE,
    );
    await this.notify(failed);
    return failed ? 'failed' : 'stale';
  }

  /** Never retried or awaited past the bound: a late `add` is still delivered when Redis returns, and a retry would double-count stats (`enqueueGraded` has no `jobId`). */
  private async notify(job: SubmissionGradedJob | null): Promise<void> {
    if (!job) return;
    try {
      await withinTimeout(enqueueGraded(this.graded, job), ENQUEUE_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(
        `Graded job of submission ${job.submissionId} not enqueued: ${(error as Error).message}`,
      );
    }
  }
}
