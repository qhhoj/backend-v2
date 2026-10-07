import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { strictlyAbove } from '@libs/community';
import { User } from '@libs/database';
import type { LeaderboardField } from '@libs/database';
import type { Model } from 'mongoose';
import { LISTED_USERS } from '../core/listed-users';

@Injectable()
export class LeaderboardsRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** Listed, active users strictly above `value` on `field`, through the leaderboard indexes. */
  countAbove(field: LeaderboardField, value: number | null): Promise<number> {
    return this.users
      .countDocuments({ ...LISTED_USERS, ...strictlyAbove(field, value) })
      .exec();
  }
}
