import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Rating, toUuid, uuidStr } from '@libs/database';

@Injectable()
export class RatingsRepository {
  constructor(
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
  ) {}

  /** Through the `{contest, user}` index. */
  async hasRatings(contestId: string): Promise<boolean> {
    return (await this.ratings.exists({ contest: contestId }).exec()) !== null;
  }

  async byParticipation(
    participationIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.ratings
      .find(
        { participation: { $in: participationIds } },
        { participation: 1, rating: 1 },
      )
      .lean()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row.participation), row.rating]));
  }

  /** Legacy `old_rating`: the latest rating of a contest that ended before `before`, through `{user, contestEndTime}`. */
  async latestBefore(
    userIds: string[],
    before: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.ratings
      .aggregate<{ _id: unknown; rating: number }>([
        {
          $match: {
            user: { $in: userIds.map(toUuid) },
            contestEndTime: { $lt: before },
          },
        },
        { $sort: { user: 1, contestEndTime: -1 } },
        { $group: { _id: '$user', rating: { $first: '$rating' } } },
      ])
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.rating]));
  }
}
