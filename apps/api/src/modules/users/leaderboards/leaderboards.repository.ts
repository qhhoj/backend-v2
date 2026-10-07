import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { strictlyAbove } from '@libs/community';
import { User } from '@libs/database';
import type { LeaderboardField } from '@libs/database';
import type { Model } from 'mongoose';
import { LISTED_USERS } from '../core/listed-users';

export type LeaderboardRow = Pick<
  User,
  | '_id'
  | 'username'
  | 'usernameDisplayOverride'
  | 'displayRank'
  | 'points'
  | 'performancePoints'
  | 'problemCount'
  | 'rating'
  | 'contributionPoints'
  | 'organizations'
>;
const PROJECTION = {
  username: 1,
  usernameDisplayOverride: 1,
  displayRank: 1,
  points: 1,
  performancePoints: 1,
  problemCount: 1,
  rating: 1,
  contributionPoints: 1,
  organizations: 1,
};

/** Every query walks `{isUnlisted, isActive, <field>: -1, _id: 1}`. */
@Injectable()
export class LeaderboardsRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  page(
    field: LeaderboardField,
    page: number,
    pageSize: number,
  ): Promise<LeaderboardRow[]> {
    return this.users
      .find(LISTED_USERS, PROJECTION)
      .sort({ [field]: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<LeaderboardRow[]>()
      .exec();
  }

  count(): Promise<number> {
    return this.users.countDocuments(LISTED_USERS).exec();
  }

  /** Listed, active users strictly above `value` on `field`, through the leaderboard indexes. */
  countAbove(field: LeaderboardField, value: number | null): Promise<number> {
    return this.users
      .countDocuments({ ...LISTED_USERS, ...strictlyAbove(field, value) })
      .exec();
  }

  /** Ties listed before the user (legacy `id__lt`). */
  countTiedBefore(
    field: LeaderboardField,
    value: number | null,
    userId: string,
  ): Promise<number> {
    return this.users
      .countDocuments({ ...LISTED_USERS, [field]: value, _id: { $lt: userId } })
      .exec();
  }
}
