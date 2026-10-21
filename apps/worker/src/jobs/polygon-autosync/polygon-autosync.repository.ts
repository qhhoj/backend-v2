import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Contest, Problem } from '@libs/database';
import type { LinkedProblem } from '@libs/problems';
import type { Model } from 'mongoose';

export type AutoSyncProblem = LinkedProblem & { _id: string };

@Injectable()
export class PolygonAutoSyncRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  /** Live problems linked with auto-sync on, as plain objects with string ids (they go into job data). The `$type` filter matches the unique partial index on the link's problem id, so the scan uses it. */
  async autoSyncProblems(): Promise<AutoSyncProblem[]> {
    const rows = await this.problems
      .find(
        {
          'polygonLink.problemId': { $type: 'number' },
          'polygonLink.autoSync': true,
          deletedAt: null,
        },
        { code: 1, isFullMarkup: 1, dataVersion: 1, polygonLink: 1 },
      )
      .exec();
    return rows.map(
      (row) => row.toObject({ getters: true }) as unknown as AutoSyncProblem,
    );
  }

  /** A contest that uses the problem is running now: its statement and tests must not change under the contestants. */
  async inRunningContest(problemId: string, now: Date): Promise<boolean> {
    return Boolean(
      await this.contests.exists({
        'problems.problem': problemId,
        startTime: { $lte: now },
        endTime: { $gt: now },
      }),
    );
  }
}
