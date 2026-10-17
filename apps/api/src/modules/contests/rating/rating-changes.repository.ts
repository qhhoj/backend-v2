import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Rating, toUuid, uuidStr } from '@libs/database';

/** What one rated contest did to a participant's rating. */
export interface RatingChange {
  /** The rating after this contest. */
  rating: number;
  /** `rating` minus the rating before this contest; null on the user's first rated contest (as the profile chart). */
  delta: number | null;
}

type RatingRow = Pick<
  Rating,
  'user' | 'contest' | 'participation' | 'rating' | 'contestEndTime'
>;

const PROJECTION = {
  user: 1,
  contest: 1,
  participation: 1,
  rating: 1,
  contestEndTime: 1,
} as const;

/** Reads the `ratings` the rating job wrote; a user's history is ordered `contestEndTime` desc, `contest` desc, as the job orders it. */
@Injectable()
export class RatingChangesRepository {
  constructor(
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
  ) {}

  /** Per participation id, the change of every rated participant; empty while the contest has no ratings. */
  async ofContest(contestId: string): Promise<Map<string, RatingChange>> {
    const rows = await this.ratings
      .find({ contest: contestId }, PROJECTION)
      .lean<RatingRow[]>()
      .exec();
    return this.withDeltas(rows);
  }

  /** The change of one participation, null when it was not rated. */
  async ofParticipation(participationId: string): Promise<RatingChange | null> {
    const row = await this.ratings
      .findOne({ participation: participationId }, PROJECTION)
      .lean<RatingRow>()
      .exec();
    if (!row) return null;
    return (await this.withDeltas([row])).get(participationId) ?? null;
  }

  /** Rows of one contest, each with its user's previous rating: the latest rating ordered before this contest (one grouped read over `{user, contestEndTime, contest}`). */
  private async withDeltas(
    rows: RatingRow[],
  ): Promise<Map<string, RatingChange>> {
    const first = rows[0];
    if (!first) return new Map();
    const before = [
      { contestEndTime: { $lt: first.contestEndTime } },
      {
        contestEndTime: first.contestEndTime,
        contest: { $lt: toUuid(uuidStr(first.contest)) },
      },
    ];
    const previous = new Map(
      (
        await this.ratings
          .aggregate<{ _id: unknown; rating: number }>([
            {
              $match: {
                user: { $in: rows.map((row) => toUuid(uuidStr(row.user))) },
                $or: before,
              },
            },
            { $sort: { user: 1, contestEndTime: -1, contest: -1 } },
            { $group: { _id: '$user', rating: { $first: '$rating' } } },
          ])
          .exec()
      ).map((row) => [uuidStr(row._id), row.rating]),
    );
    return new Map(
      rows.map((row) => {
        const last = previous.get(uuidStr(row.user));
        return [
          uuidStr(row.participation),
          {
            rating: row.rating,
            delta: last === undefined ? null : row.rating - last,
          },
        ];
      }),
    );
  }
}
