import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { Submission, User, uuidStr } from '@libs/database';

/** Best first: most points, then fastest (a row without a time, such as an overridden compile error, after every timed one), then least memory, then earliest. */
const BEST_FIRST = {
  points: -1,
  noTime: 1,
  time: 1,
  memory: 1,
  date: 1,
  _id: 1,
} as const;

/** What a list row shows (`contest` is read for the row's contest block); the source, error log and cases stay out of the grouping. */
const ROW_FIELDS = {
  user: 1,
  problem: 1,
  contest: 1,
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

/** A contest submission's points are its `contestSubmissions` row's (case ratio × the contest problem's points, 0 for a partial result on a problem without partial scores): what the ranking counts. Rows without one score 0 and are left out. */
const CONTEST_POINTS_STAGES = [
  {
    $lookup: {
      from: 'contestSubmissions',
      localField: '_id',
      foreignField: '_id',
      as: 'contestRow',
    },
  },
  { $set: { points: { $ifNull: [{ $first: '$contestRow.points' }, 0] } } },
  { $match: { points: { $gt: 0 } } },
  { $unset: 'contestRow' },
];

@Injectable()
export class BestSubmissionsRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /**
   * With `byContestPoints` the points are the contest's (see `CONTEST_POINTS_STAGES`) and replace the raw ones in the rows.
   * One row per listed user, their best graded submission with points among `filter`, best first.
   * Unlisted (and banned) users are left out by `$nin` of their ids, as problem stats do: they are few.
   * The match reads `{problem, status, _id}`; the per-user pick needs no index of its own.
   */
  async page(
    filter: FilterQuery<Submission>,
    page: number,
    pageSize: number,
    { byContestPoints = false } = {},
  ): Promise<{ items: Submission[]; total: number }> {
    const unlisted = (
      await this.users.distinct('_id', { isUnlisted: true }).exec()
    ).map(uuidStr);
    // `aggregate` does not cast: the list filter's string ids become UUIDs here.
    const match = this.submissions.find().cast(this.submissions, {
      $and: [
        filter,
        {
          status: 'D',
          user: { $nin: unlisted },
          // Contest rows score through their `contestSubmissions` row below.
          ...(byContestPoints ? {} : { points: { $gt: 0 } }),
        },
      ],
    }) as FilterQuery<Submission>;
    const [result] = await this.submissions
      .aggregate<{ items: Submission[]; total: Array<{ count: number }> }>([
        { $match: match },
        ...(byContestPoints ? CONTEST_POINTS_STAGES : []),
        { $project: ROW_FIELDS },
        // a null time sorts before every number
        { $set: { noTime: { $eq: [{ $ifNull: ['$time', null] }, null] } } },
        {
          $group: {
            _id: '$user',
            best: { $top: { sortBy: BEST_FIRST, output: '$$ROOT' } },
          },
        },
        { $replaceWith: '$best' },
        { $sort: BEST_FIRST },
        { $unset: 'noTime' },
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
