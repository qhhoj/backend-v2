import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { strictlyAbove } from '@libs/community';
import { User } from '@libs/database';
import type { Model } from 'mongoose';

export const MEMBER_SORTS = [
  'performancePoints',
  'points',
  'problemCount',
  'rating',
] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];
export type MemberRow = Pick<
  User,
  | '_id'
  | 'username'
  | 'usernameDisplayOverride'
  | 'displayRank'
  | 'points'
  | 'performancePoints'
  | 'problemCount'
  | 'rating'
>;
/** Bounds every read by the organization's size: other sorts would otherwise pick a site-wide leaderboard index. */
const MEMBERSHIP_INDEX = { organizations: 1, performancePoints: -1 };
const MEMBER_PROJECTION = {
  username: 1,
  usernameDisplayOverride: 1,
  displayRank: 1,
  points: 1,
  performancePoints: 1,
  problemCount: 1,
  rating: 1,
};

/** Every read and write of `users.organizations` (the membership). Lists go through `{organizations, performancePoints}`; other sorts sort the organization's members in memory. */
@Injectable()
export class OrganizationMembersRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** Legacy `OrganizationUsers`: listed members, ties by id. */
  async members(
    organizationId: string,
    sort: MemberSort,
    page: number,
    pageSize: number,
  ): Promise<{ items: MemberRow[]; total: number }> {
    const filter = { organizations: organizationId, isUnlisted: false };
    const [items, total] = await Promise.all([
      this.users
        .find(filter, MEMBER_PROJECTION)
        .hint(MEMBERSHIP_INDEX)
        .sort({ [sort]: -1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<MemberRow[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Listed members ranked above `value`: the first row's rank minus one. */
  countAbove(
    organizationId: string,
    sort: MemberSort,
    value: number | null,
  ): Promise<number> {
    return this.users
      .countDocuments(
        {
          organizations: organizationId,
          isUnlisted: false,
          ...strictlyAbove(sort, value),
        },
        { hint: MEMBERSHIP_INDEX },
      )
      .exec();
  }

  /** Every member, listed or not: the live count approvals check `slots` against. */
  countMembers(organizationId: string): Promise<number> {
    return this.users.countDocuments({ organizations: organizationId }).exec();
  }

  async isMember(userId: string, organizationId: string): Promise<boolean> {
    return (
      (await this.users
        .exists({ _id: userId, organizations: organizationId })
        .exec()) !== null
    );
  }
}
