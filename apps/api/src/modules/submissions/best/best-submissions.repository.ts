import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { Submission, User, uuidStr } from '@libs/database';

/** Best first: most points, then fastest, then least memory, then earliest. */
const BEST_FIRST = {
  points: -1,
  time: 1,
  memory: 1,
  date: 1,
  _id: 1,
} as const;

/** What a list row shows; the source, error log and cases stay out of the grouping. */
const ROW_FIELDS = {
  user: 1,
  problem: 1,
  language: 1,
  date: 1,
  status: 1,
  result: 1,
  points: 1,
  casePoints: 1,
  caseTotal: 1,
  time: 1,
  memory: 1,
} as const;

@Injectable()
export class BestSubmissionsRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /**
   * One row per listed user, their best graded submission with points among `filter`, best first.
   * Unlisted (and banned) users are left out by `$nin` of their ids, as problem stats do: they are few.
   * The match reads `{problem, status, _id}`; the per-user pick needs no index of its own.
   */
  async page(
    filter: FilterQuery<Submission>,
    page: number,
    pageSize: number,
  ): Promise<{ items: Submission[]; total: number }> {
    const unlisted = (
      await this.users.distinct('_id', { isUnlisted: true }).exec()
    ).map(uuidStr);
    // `aggregate` does not cast: the list filter's string ids become UUIDs here.
    const match = this.submissions.find().cast(this.submissions, {
      $and: [
        filter,
        { status: 'D', points: { $gt: 0 }, user: { $nin: unlisted } },
      ],
    }) as FilterQuery<Submission>;
    const [result] = await this.submissions
      .aggregate<{ items: Submission[]; total: Array<{ count: number }> }>([
        { $match: match },
        { $project: ROW_FIELDS },
        {
          $group: {
            _id: '$user',
            best: { $top: { sortBy: BEST_FIRST, output: '$$ROOT' } },
          },
        },
        { $replaceWith: '$best' },
        { $sort: BEST_FIRST },
        {
          $facet: {
            items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();
    return { items: result.items, total: result.total[0]?.count ?? 0 };
  }
}
