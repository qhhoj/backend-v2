import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Submission, toUuid, uuidStr } from '@libs/database';
import { IS_SOLVED } from '@libs/judging';

/** Legacy `user_completed_ids` / `user_attempted_ids`: solved = some AC whose cases earned everything, attempted = any other submission (compile errors and queued ones included). */
export type ViewerStatus = 'solved' | 'attempted' | null;

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
  ): Promise<Map<string, Exclude<ViewerStatus, null>>> {
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
          solved: { $max: { $cond: [IS_SOLVED, 1, 0] } },
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
}
