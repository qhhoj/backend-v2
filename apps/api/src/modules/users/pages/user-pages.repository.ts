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
import type { Model } from 'mongoose';

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

/** The user's scored submissions outside `hiddenContests` (practice ones have no contest and always count). */
const scoredOutside = (userId: string, hiddenContests: readonly string[]) => ({
  $match: {
    user: toUuid(userId),
    points: { $gt: 0 },
    ...(hiddenContests.length && {
      contest: { $nin: hiddenContests.map(toUuid) },
    }),
  },
});

/** Public, non-organization-private, not-deleted problems: what legacy counts on user pages. */
const publicProblem = (from: string, project: Record<string, 0 | 1>) => ({
  $lookup: {
    from,
    localField: '_id',
    foreignField: '_id',
    pipeline: [
      {
        $match: {
          isPublic: true,
          isOrganizationPrivate: false,
          deletedAt: null,
        },
      },
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

  /** Oldest first through `{user, contestEndTime, contest}`, with what `ContestAccess` reads to tell what a viewer may see of each contest. */
  async ratingHistory(
    userId: string,
  ): Promise<Array<{ rating: Rating; contest: Contest | null }>> {
    const ratings = await this.ratings
      .find({ user: userId })
      .sort({ contestEndTime: 1, contest: 1 })
      .lean<Rating[]>()
      .exec();
    const contests = new Map(
      (
        await this.contests
          .find(
            { _id: { $in: ratings.map((row) => uuidStr(row.contest)) } },
            {
              key: 1,
              name: 1,
              startTime: 1,
              endTime: 1,
              timeLimit: 1,
              frozenLastMinutes: 1,
              formatName: 1,
              isVisible: 1,
              isPrivate: 1,
              isOrganizationPrivate: 1,
              organizations: 1,
              privateContestants: 1,
              authors: 1,
              curators: 1,
              testers: 1,
              viewContestScoreboard: 1,
              balloonStaff: 1,
              scoreboardVisibility: 1,
            },
          )
          .lean<Contest[]>()
          .exec()
      ).map((contest) => [uuidStr(contest._id), contest]),
    );
    return ratings.map((rating) => ({
      rating,
      contest: contests.get(uuidStr(rating.contest)) ?? null,
    }));
  }

  /** Legacy `UserProblemsPage`: best positive points per public problem, leaving out `hiddenContests`. */
  solved(
    userId: string,
    hiddenContests: readonly string[],
  ): Promise<SolvedRow[]> {
    return this.submissions
      .aggregate<SolvedRow>([
        scoredOutside(userId, hiddenContests),
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

  /** Legacy `get_pp_breakdown`: per public problem the best, latest submission outside `hiddenContests`, best first, at most `limit` rows. */
  ppBreakdown(
    userId: string,
    limit: number,
    hiddenContests: readonly string[],
  ): Promise<BestSubmissionRow[]> {
    return this.submissions
      .aggregate<BestSubmissionRow>([
        scoredOutside(userId, hiddenContests),
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

  /** Submissions per day in `timezone` since `since`, through `{user, date}`, leaving out `hiddenContests`. */
  async activity(
    userId: string,
    since: Date,
    timezone: string,
    hiddenContests: readonly string[],
  ): Promise<Array<{ _id: string; count: number }>> {
    try {
      return await this.submissions
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              user: toUuid(userId),
              date: { $gte: since },
              ...(hiddenContests.length && {
                contest: { $nin: hiddenContests.map(toUuid) },
              }),
            },
          },
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
