import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, User } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';
import { usernamePrefixFilter } from '../core/username-prefix';
import type { StaffUserSort } from './dto/user-admin.dto';

export type StaffUserRow = Pick<
  User,
  | '_id'
  | 'username'
  | 'rating'
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
  rating: 1,
  usernameDisplayOverride: 1,
  displayRank: 1,
  isActive: 1,
  isStaff: 1,
  isSuperuser: 1,
  banReason: 1,
  dateJoined: 1,
  lastAccess: 1,
};

export interface StaffUserFilter {
  search?: string;
  /** Unset: everyone. True: banned only. False: not banned only. */
  banned?: boolean;
  sort?: StaffUserSort;
}

const searchFilter = (search?: string): FilterQuery<User> =>
  search ? usernamePrefixFilter(search) : {};

const bannedFilter = (banned?: boolean): FilterQuery<User> => {
  if (banned === undefined) return {};
  // `banReason` is null (or missing) for users who are not banned.
  return { banReason: banned ? { $type: 'string' } : null };
};

/** An explicit sort wins; a search is ordered by username so the username index serves the order; otherwise newest first. */
const orderOf = ({ search, sort }: StaffUserFilter): Record<string, 1 | -1> => {
  if (sort) {
    const direction = sort.startsWith('-') ? -1 : 1;
    return { lastAccess: direction, _id: direction };
  }
  return search ? { username: 1 } : { _id: -1 };
};

@Injectable()
export class UserAdminRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** The search is a collated range over the username index, never a regex. */
  async page(
    criteria: StaffUserFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: StaffUserRow[]; total: number }> {
    const { search, banned } = criteria;
    const filter: FilterQuery<User> = {
      ...searchFilter(search),
      ...bannedFilter(banned),
    };
    const options = search ? { collation: CI } : {};
    const [items, total] = await Promise.all([
      this.users
        .find(filter, PROJECTION, options)
        .sort(orderOf(criteria))
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<StaffUserRow[]>()
        .exec(),
      this.users.countDocuments(filter, options).exec(),
    ]);
    return { items, total };
  }
}
