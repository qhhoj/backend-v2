import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Submission, toUuid, uuidStr } from '@libs/database';
import { ANY_SOLVED } from '@libs/judging';

/** Legacy `user_completed_ids` / `user_attempted_ids`: solved = some AC whose cases earned everything, attempted = any other submission (compile errors and queued ones included). */
export type ViewerMark = 'solved' | 'attempted';
export type ViewerStatus = ViewerMark | null;

@Injectable()
export class ViewerStatusRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** One aggregate per page on `{ user, problem, result }`; a problem without a submission of the viewer is absent. */
  async statusesOf(
    userId: string,
    problemIds: string[],
  ): Promise<Map<string, ViewerMark>> {
    if (!problemIds.length) return new Map();
    const rows = await this.submissions.aggregate<{
      _id: unknown;
      solved: number;
    }>([
      {
        $match: {
          user: toUuid(userId),
          problem: { $in: problemIds.map(toUuid) },
        },
      },
      {
        $group: {
          _id: '$problem',
          solved: ANY_SOLVED,
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        row.solved ? 'solved' : 'attempted',
      ]),
    );
  }

  /** Problems with an AC that earned every case point: the same rule as `statusesOf`, one aggregate over the viewer's AC rows, hinted so the planner never falls back to walking every row of the viewer. */
  async solvedIds(userId: string): Promise<string[]> {
    const rows = await this.submissions
      .aggregate<{ _id: unknown }>([
        { $match: { user: toUuid(userId), result: 'AC' } },
        { $group: { _id: '$problem', solved: ANY_SOLVED } },
        { $match: { solved: 1 } },
      ])
      .hint({ user: 1, problem: 1, result: 1 });
    return rows.map((row) => uuidStr(row._id));
  }
}
