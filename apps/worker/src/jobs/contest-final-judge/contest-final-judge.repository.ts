import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  Contest,
  Submission,
  SUBMISSION_PRIORITY,
  uuidStr,
} from '@libs/database';
import { gradedJobOf, JUDGEABLE_PENDING, requeueUpdate } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';

export type FinalJudgeContest = Pick<
  Contest,
  'formatName' | 'formatConfig' | 'startTime' | 'endTime'
>;

@Injectable()
export class ContestFinalJudgeRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  findContest(contestId: string): Promise<FinalJudgeContest | null> {
    return this.contests
      .findById(contestId, {
        formatName: 1,
        formatConfig: 1,
        startTime: 1,
        endTime: 1,
      })
      .lean<FinalJudgeContest>()
      .exec();
  }

  /** Contests holding pending rows (`{status, contest, _id}` index). */
  async pendingContestIds(): Promise<string[]> {
    return (
      await this.submissions.distinct('contest', JUDGEABLE_PENDING).exec()
    )
      .filter((id) => id !== null)
      .map(uuidStr);
  }

  /** The oldest pending rows of the contest, in id order (same index). */
  async pendingRows(
    contestId: string,
    limit: number,
  ): Promise<SubmissionGradedJob[]> {
    const rows = await this.submissions
      .find(
        { ...JUDGEABLE_PENDING, contest: contestId },
        { _id: 1, user: 1, problem: 1 },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .lean();
    return rows.map(gradedJobOf);
  }

  /** The api's rejudge reset (`requeueUpdate`) at batch priority, keeping a judge pinned at submit (this is the row's first run); only rows still PD move, so a row leaves PD once. */
  async requeue(ids: string[]): Promise<void> {
    await this.submissions
      .updateMany(
        { _id: { $in: ids }, ...JUDGEABLE_PENDING },
        requeueUpdate(SUBMISSION_PRIORITY.batchRejudge, { keepsPin: true }),
      )
      .exec();
  }
}
