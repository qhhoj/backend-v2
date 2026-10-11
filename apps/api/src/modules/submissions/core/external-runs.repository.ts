import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ExternalRun } from '@libs/database';
import type { Model } from 'mongoose';
import type { SubmissionExternalRunResponse } from './dto/submission-detail.response';

/** The remote side of a submission's run on the external judge. */
@Injectable()
export class ExternalRunsRepository {
  constructor(
    @InjectModel(ExternalRun.name) private readonly runs: Model<ExternalRun>,
  ) {}

  /** The run of the submission's current judging generation; a document of an older generation (a rejudge is on its way) is stale and not shown. */
  async current(
    submissionId: string,
    generation: number,
  ): Promise<SubmissionExternalRunResponse | null> {
    const run = await this.runs
      .findOne({ _id: submissionId, generation })
      .lean<ExternalRun>()
      .exec();
    return (
      run && {
        oj: run.oj,
        problemId: run.problemId,
        remoteId: run.remoteId,
        systemStatus: run.systemStatus,
        statusCanonical: run.statusCanonical,
        scoreText: run.scoreText,
        remoteUrl: run.remoteUrl,
        submittedAt: run.submittedAt,
      }
    );
  }
}
