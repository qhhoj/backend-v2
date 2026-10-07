import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppError } from '@libs/common';
import {
  Contest,
  Problem,
  Rating,
  Submission,
  toUuid,
  uuidStr,
} from '@libs/database';
import { ANY_SOLVED } from '@libs/judging';
import type { FilterQuery, Model } from 'mongoose';

/** Mongo's `$dateToString` rejects a zone its tzdata lacks (ICU may know it). */
const UNKNOWN_TIME_ZONE_CODE = 40485;

export interface BestSubmissionRow {
  _id: unknown;
  submission: {
    _id: unknown;
    points: number;
    date: Date;
    casePoints: number;
    caseTotal: number;
    result: string | null;
    language: unknown;
  };
  problem: { code: string; name: string };
}
export interface SolvedRow {
  points: number;
  problem: { code: string; name: string; points: number; groupId: unknown };
}

/** Public, non-organization-private problems: what legacy counts on user pages. */
const publicProblem = (from: string, project: Record<string, 0 | 1>) => ({
  $lookup: {
    from,
    localField: '_id',
    foreignField: '_id',
    pipeline: [
      { $match: { isPublic: true, isOrganizationPrivate: false } },
      { $project: { _id: 0, ...project } },
    ],
    as: 'problem',
  },
});

@Injectable()
export class UserPagesRepository {
  constructor(
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  async ratingSummary(
    userId: string,
  ): Promise<{ min: number; max: number; contests: number } | null> {
    const [row] = await this.ratings.aggregate<{
      min: number;
      max: number;
      contests: number;
    }>([
      { $match: { user: toUuid(userId) } },
      {
        $group: {
          _id: null,
          min: { $min: '$rating' },
          max: { $max: '$rating' },
          contests: { $sum: 1 },
        },
      },
      { $project: { _id: 0, min: 1, max: 1, contests: 1 } },
    ]);
    return row ?? null;
  }

  /** Oldest first through `{user, contestEndTime, contest}`; a contest outside `contestFilter` comes back as null. */
  async ratingHistory(
    userId: string,
    contestFilter: FilterQuery<Contest>,
  ): Promise<
    Array<{ rating: Rating; contest: Pick<Contest, 'key' | 'name'> | null }>
  > {
    const ratings = await this.ratings
      .find({ user: userId })
      .sort({ contestEndTime: 1, contest: 1 })
      .lean<Rating[]>()
      .exec();
    const contests = new Map(
      (
        await this.contests
          .find(
            {
              $and: [
                { _id: { $in: ratings.map((row) => uuidStr(row.contest)) } },
                contestFilter,
              ],
            },
            { key: 1, name: 1 },
          )
          .lean()
          .exec()
      ).map((contest) => [uuidStr(contest._id), contest]),
    );
    return ratings.map((rating) => ({
      rating,
      contest: contests.get(uuidStr(rating.contest)) ?? null,
    }));
  }

  /** Legacy `UserProblemsPage`: best positive points per public problem. */
  solved(userId: string): Promise<SolvedRow[]> {
    return this.submissions
      .aggregate<SolvedRow>([
        { $match: { user: toUuid(userId), points: { $gt: 0 } } },
        { $group: { _id: '$problem', points: { $max: '$points' } } },
        publicProblem(this.problems.collection.name, {
          code: 1,
          name: 1,
          points: 1,
          groupId: 1,
        }),
        { $unwind: '$problem' },
      ])
      .exec();
  }

  /** Codes of public, non-organization-private problems the user solved (`IS_SOLVED`, like `problemCount`). */
  async solvedCodes(userId: string): Promise<string[]> {
    const rows = await this.submissions
      .aggregate<{ problem: { code: string } }>([
        { $match: { user: toUuid(userId), result: 'AC' } },
        { $group: { _id: '$problem', solved: ANY_SOLVED } },
        { $match: { solved: 1 } },
        publicProblem(this.problems.collection.name, { code: 1 }),
        { $unwind: '$problem' },
      ])
      .exec();
    return rows.map((row) => row.problem.code).sort();
  }

  /** Legacy `get_pp_breakdown`: per public problem the best, latest submission, best first, at most `limit` rows. */
  ppBreakdown(userId: string, limit: number): Promise<BestSubmissionRow[]> {
    return this.submissions
      .aggregate<BestSubmissionRow>([
        { $match: { user: toUuid(userId), points: { $gt: 0 } } },
        {
          $project: {
            problem: 1,
            points: 1,
            date: 1,
            casePoints: 1,
            caseTotal: 1,
            result: 1,
            language: 1,
          },
        },
        { $sort: { problem: 1, points: -1, date: -1, _id: -1 } },
        { $group: { _id: '$problem', submission: { $first: '$$ROOT' } } },
        publicProblem(this.problems.collection.name, { code: 1, name: 1 }),
        { $unwind: '$problem' },
        { $sort: { 'submission.points': -1, 'submission.date': -1, _id: 1 } },
        { $limit: limit },
      ])
      .allowDiskUse(true)
      .exec();
  }

  /** Submissions per day in `timezone` since `since`, through `{user, date}`. */
  async activity(
    userId: string,
    since: Date,
    timezone: string,
  ): Promise<Array<{ _id: string; count: number }>> {
    try {
      return await this.submissions
        .aggregate<{ _id: string; count: number }>([
          { $match: { user: toUuid(userId), date: { $gte: since } } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$date', timezone },
              },
              count: { $sum: 1 },
            },
          },
        ])
        .exec();
    } catch (error) {
      if ((error as { code?: number }).code === UNKNOWN_TIME_ZONE_CODE)
        throw new AppError('validation_failed', 400, 'Unknown time zone', {
          timezone: ['Must be an IANA time zone name.'],
        });
      throw error;
    }
  }
}
