import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Submission, toUuid, uuidStr } from '@libs/database';
import type { SubmissionResult } from '@libs/database';

@Injectable()
export class ContestStatsRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** One grouped read per breakdown, through `{contest:1,_id:-1}`. */
  async countsBy(
    contestId: string,
    startTime: Date,
    field: 'problem' | 'language',
  ): Promise<
    Array<{ key: string; result: SubmissionResult | null; count: number }>
  > {
    const rows = await this.submissions
      .aggregate<{
        _id: { key: unknown; result: SubmissionResult | null };
        count: number;
      }>([
        { $match: { contest: toUuid(contestId), date: { $gt: startTime } } },
        {
          $group: {
            _id: { key: `$${field}`, result: '$result' },
            count: { $sum: 1 },
          },
        },
      ])
      .hint({ contest: 1, _id: -1 })
      .exec();
    return rows.map((row) => ({
      key: uuidStr(row._id.key),
      result: row._id.result,
      count: row.count,
    }));
  }
}
