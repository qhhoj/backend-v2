import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, User } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';

export type StaffUserRow = Pick<
  User,
  | '_id'
  | 'username'
  | 'usernameDisplayOverride'
  | 'displayRank'
  | 'isActive'
  | 'isStaff'
  | 'isSuperuser'
  | 'banReason'
  | 'dateJoined'
  | 'lastAccess'
>;

/** Only the fields `StaffUserResponse` shows, so no secret is ever loaded. */
const PROJECTION = {
  username: 1,
  usernameDisplayOverride: 1,
  displayRank: 1,
  isActive: 1,
  isStaff: 1,
  isSuperuser: 1,
  banReason: 1,
  dateJoined: 1,
  lastAccess: 1,
};

/** The U+FFFF sentinel sorts after every username that starts with the search. */
const PREFIX_END = '￿';

export interface StaffUserFilter {
  search?: string;
  banned?: boolean;
}

@Injectable()
export class UserAdminRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** Newest first. The search is a collated range over the username index, never a regex. */
  async page(
    { search, banned }: StaffUserFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: StaffUserRow[]; total: number }> {
    const filter: FilterQuery<User> = {
      ...(search
        ? { username: { $gte: search, $lt: `${search}${PREFIX_END}` } }
        : {}),
      ...(banned ? { banReason: { $type: 'string' } } : {}),
    };
    const options = search ? { collation: CI } : {};
    const [items, total] = await Promise.all([
      this.users
        .find(filter, PROJECTION, options)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<StaffUserRow[]>()
        .exec(),
      this.users.countDocuments(filter, options).exec(),
    ]);
    return { items, total };
  }
}
