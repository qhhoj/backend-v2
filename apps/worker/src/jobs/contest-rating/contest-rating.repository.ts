import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { LIVE } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  Rating,
  toUuid,
  User,
  uuidStr,
} from '@libs/database';

export interface RatableContest {
  _id: string;
  endTime: Date;
  isRated: boolean;
  rateAll: boolean;
  rateExclude: string[];
  ratingFloor: number | null;
  ratingCeiling: number | null;
}
export interface Candidate {
  participationId: string;
  userId: string;
  score: number;
  cumtime: number;
  tiebreaker: number;
  isDisqualified: boolean;
  submissions: number;
}
export interface RatingHistory {
  lastRating: number;
  lastMean: number;
  /** Performances, newest first. */
  performances: number[];
}

const RATABLE_FIELDS = {
  endTime: 1,
  isRated: 1,
  rateAll: 1,
  rateExclude: 1,
  ratingFloor: 1,
  ratingCeiling: 1,
};

/** Every method takes the session of `inTransaction`: a re-rate reads its own uncommitted deletes and inserts. */
@Injectable()
export class ContestRatingRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** `work` may run again after a transient transaction error, so it must start from a clean read. */
  inTransaction<Result>(
    work: (session: ClientSession) => Promise<Result>,
  ): Promise<Result> {
    return this.connection.transaction(work);
  }

  async findContest(
    id: string,
    session: ClientSession,
  ): Promise<RatableContest | null> {
    const row = await this.contests
      .findById(id, RATABLE_FIELDS)
      .session(session)
      .lean<RatableContest>()
      .exec();
    return row ? ratable(row) : null;
  }

  /** The earliest `contestEndTime` stored for the contest (its end before an edit), null without ratings. Through the `{contest, user}` index. */
  async earliestRatingEnd(
    contestId: string,
    session: ClientSession,
  ): Promise<Date | null> {
    const row = await this.ratings
      .findOne({ contest: contestId }, { contestEndTime: 1 })
      .sort({ contestEndTime: 1 })
      .session(session)
      .lean<{ contestEndTime: Date }>()
      .exec();
    return row?.contestEndTime ?? null;
  }

  /** The earliest current end below `start` of a contest that still has a rating stored at or after `start` (an edit moved it earlier, its job has not run), null without one. Through the `contestEndTime` index. */
  async earliestMovedEarlierEnd(
    start: Date,
    session: ClientSession,
  ): Promise<Date | null> {
    const contestIds = await this.ratings
      .distinct('contest', { contestEndTime: { $gte: start } })
      .session(session)
      .exec();
    const row = await this.contests
      .findOne(
        { _id: { $in: contestIds }, endTime: { $lt: start } },
        { endTime: 1 },
      )
      .sort({ endTime: 1 })
      .session(session)
      .lean<{ endTime: Date }>()
      .exec();
    return row?.endTime ?? null;
  }

  /** Rated contests ending in `[endTime, now]`, in end order (`endTime` index). */
  async ratedContestsFrom(
    endTime: Date,
    now: Date,
    session: ClientSession,
  ): Promise<RatableContest[]> {
    const rows = await this.contests
      .find(
        { isRated: true, endTime: { $gte: endTime, $lte: now } },
        RATABLE_FIELDS,
      )
      .sort({ endTime: 1, _id: 1 })
      .session(session)
      .lean<RatableContest[]>()
      .exec();
    return rows.map(ratable);
  }

  /**
   * Deletes every rating of a contest ending at or after `endTime`, plus every rating of `contestIds` whatever its stored end (an edited end time must never leave a stale row or collide with the re-insert).
   * Unbounded by design, like legacy `Contest.rate`: one range delete over the `contestEndTime` index inside the run's transaction.
   * Returns the users who lost a rating.
   */
  async deleteFrom(
    endTime: Date,
    contestIds: string[],
    session: ClientSession,
  ): Promise<string[]> {
    const filter = {
      $or: [
        { contestEndTime: { $gte: endTime } },
        { contest: { $in: contestIds } },
      ],
    };
    const users = await this.ratings
      .distinct('user', filter)
      .session(session)
      .exec();
    await this.ratings.deleteMany(filter, { session }).exec();
    return users.map(uuidStr);
  }

  /** Live, joined rows, with their contest-submission counts (one grouped read over `{participation, problem}`). */
  async candidates(
    contestId: string,
    session: ClientSession,
  ): Promise<Candidate[]> {
    const rows = await this.participations
      .find(
        { contest: contestId, virtual: LIVE, isRegistered: false },
        { user: 1, score: 1, cumtime: 1, tiebreaker: 1, isDisqualified: 1 },
      )
      .session(session)
      .lean()
      .exec();
    const counts = new Map(
      (
        await this.contestSubmissions
          .aggregate<{ _id: unknown; count: number }>([
            {
              $match: {
                participation: {
                  $in: rows.map((row) => toUuid(uuidStr(row._id))),
                },
              },
            },
            { $group: { _id: '$participation', count: { $sum: 1 } } },
          ])
          .session(session)
          .exec()
      ).map((row) => [uuidStr(row._id), row.count]),
    );
    return rows.map((row) => ({
      participationId: uuidStr(row._id),
      userId: uuidStr(row.user),
      score: row.score,
      cumtime: row.cumtime,
      tiebreaker: row.tiebreaker,
      isDisqualified: row.isDisqualified,
      submissions: counts.get(uuidStr(row._id)) ?? 0,
    }));
  }

  /** Users without a rating are absent. Every remaining rating of these users, newest first, through `{user, contestEndTime}`. */
  async histories(
    userIds: string[],
    session: ClientSession,
  ): Promise<Map<string, RatingHistory>> {
    const rows = await this.ratings
      .find(
        { user: { $in: userIds } },
        { user: 1, rating: 1, mean: 1, performance: 1 },
      )
      .sort({ user: 1, contestEndTime: -1, contest: -1 })
      .session(session)
      .lean()
      .exec();
    const histories = new Map<string, RatingHistory>();
    for (const row of rows) {
      const userId = uuidStr(row.user);
      const history = histories.get(userId);
      if (history) history.performances.push(row.performance);
      else
        histories.set(userId, {
          lastRating: row.rating,
          lastMean: row.mean,
          performances: [row.performance],
        });
    }
    return histories;
  }

  async insert(
    rows: Array<Omit<Rating, '_id'>>,
    session: ClientSession,
  ): Promise<void> {
    if (rows.length) await this.ratings.insertMany(rows, { session });
  }

  /** `users.rating` = the latest remaining rating, null without one. */
  async refreshUserRatings(
    userIds: string[],
    session: ClientSession,
  ): Promise<void> {
    if (!userIds.length) return;
    const latest = new Map(
      (
        await this.ratings
          .aggregate<{ _id: unknown; rating: number }>([
            { $match: { user: { $in: userIds.map(toUuid) } } },
            { $sort: { user: 1, contestEndTime: -1, contest: -1 } },
            { $group: { _id: '$user', rating: { $first: '$rating' } } },
          ])
          .session(session)
          .exec()
      ).map((row) => [uuidStr(row._id), row.rating]),
    );
    await this.users.bulkWrite(
      userIds.map((userId) => ({
        updateOne: {
          filter: { _id: userId },
          update: { $set: { rating: latest.get(userId) ?? null } },
        },
      })),
      { session },
    );
  }
}

const ratable = (row: RatableContest): RatableContest => ({
  ...row,
  _id: uuidStr(row._id),
  rateExclude: row.rateExclude.map(uuidStr),
});
