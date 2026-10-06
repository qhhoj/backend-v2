import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { SubmissionCase } from '@libs/database';
import { enqueueGraded, SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionsRepository } from './submissions.repository';
import type { CasesOutcome } from './submissions.repository';

export type DisconnectOutcome = 'requeued' | 'failed' | 'stale';
export const LOST_JUDGE_MESSAGE =
  'The judge disconnected twice while grading this submission';

/** What each judge packet does to its submission; a finished submission (D, CE, IE, AB) enqueues one `submission-graded` job. */
@Injectable()
export class GradingService {
  constructor(
    private readonly submissions: SubmissionsRepository,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
  ) {}

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

  private async notify(job: SubmissionGradedJob | null): Promise<void> {
    if (job) await enqueueGraded(this.graded, job);
  }
}
