import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage } from 'mongoose';
import {
  Contest,
  ContestSubmission,
  Submission,
  toUuid,
  uuidStr,
} from '@libs/database';
import { gradedJobOf, JUDGEABLE_PENDING, requeueUpdate } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';

export type FinalJudgeContest = Pick<
  Contest,
  'formatName' | 'formatConfig' | 'startTime' | 'endTime'
>;

type PendingRow = { _id: unknown; user: unknown; problem: unknown };

/** Pending rows of the contest, newest first (by date, then id), reduced to the first of each participation and problem; a row without a contest entry is its own group. */
const newestPendingPipeline = (
  contestId: string,
  contestSubmissions: string,
): PipelineStage[] => [
  { $match: { ...JUDGEABLE_PENDING, contest: toUuid(contestId) } },
  {
    $lookup: {
      from: contestSubmissions,
      localField: '_id',
      foreignField: '_id',
      pipeline: [{ $project: { participation: 1 } }],
      as: 'entry',
    },
  },
  { $sort: { date: -1, _id: -1 } },
  {
    $group: {
      _id: {
        participation: {
          $ifNull: [{ $arrayElemAt: ['$entry.participation', 0] }, '$_id'],
        },
        problem: '$problem',
      },
      newest: { $first: { _id: '$_id', user: '$user', problem: '$problem' } },
    },
  },
  { $replaceRoot: { newRoot: '$newest' } },
];

@Injectable()
export class ContestFinalJudgeRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
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

  /** The newest pending row of each participation and problem, by date then id (the order `final_submission` scores in), in batches of `size`. One aggregation over the contest's pending rows; its output is one row per group. A row without a contest entry is its own group. */
  async *newestPendingRows(
    contestId: string,
    size: number,
  ): AsyncGenerator<SubmissionGradedJob[]> {
    const cursor: AsyncIterable<PendingRow> = this.submissions
      .aggregate<PendingRow>(
        newestPendingPipeline(
          contestId,
          this.contestSubmissions.collection.name,
        ),
      )
      .allowDiskUse(true)
      .cursor({ batchSize: size });
    let batch: SubmissionGradedJob[] = [];
    for await (const row of cursor) {
      batch.push(gradedJobOf(row));
      if (batch.length < size) continue;
      yield batch;
      batch = [];
    }
    if (batch.length) yield batch;
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

  /** The api's rejudge reset (`requeueUpdate`) at `priority`, keeping a judge pinned at submit (this is the row's first run); only rows still PD move, so a row leaves PD once. */
  async requeue(ids: string[], priority: number): Promise<void> {
    await this.submissions
      .updateMany(
        { _id: { $in: ids }, ...JUDGEABLE_PENDING },
        requeueUpdate(priority, { keepsPin: true }),
      )
      .exec();
  }
}
