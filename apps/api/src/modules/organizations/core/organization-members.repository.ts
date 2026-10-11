import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { escapeRegExp } from '@libs/common';
import { strictlyAbove } from '@libs/community';
import { CI, Group, uuidStr, User } from '@libs/database';
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
export interface MemberPageQuery {
  sort: MemberSort;
  page: number;
  pageSize: number;
  search?: string;
}
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

const usernamePattern = (fragment: string) =>
  new RegExp(escapeRegExp(fragment), 'i');
/** Listed members, narrowed to usernames containing `search` when one is given. */
const listedMembers = (organizationId: string, search?: string) => ({
  organizations: organizationId,
  isUnlisted: false,
  ...(search ? { username: usernamePattern(search) } : {}),
});

/** Every read and write of `users.organizations` (the membership). Lists go through `{organizations, performancePoints}`; other sorts sort the organization's members in memory. */
@Injectable()
export class OrganizationMembersRepository {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Group.name) private readonly groups: Model<Group>,
  ) {}

  /** Legacy `OrganizationUsers`: listed members, ties by id; `search` narrows by username. */
  async members(
    organizationId: string,
    { sort, page, pageSize, search }: MemberPageQuery,
  ): Promise<{ items: MemberRow[]; total: number }> {
    const filter = listedMembers(organizationId, search);
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

  /** Listed members (matching `search`) ranked above `value`: the first row's rank minus one. */
  countAbove(
    organizationId: string,
    { sort, search }: Pick<MemberPageQuery, 'sort' | 'search'>,
    value: number | null,
  ): Promise<number> {
    return this.users
      .countDocuments(
        {
          ...listedMembers(organizationId, search),
          ...strictlyAbove(sort, value),
        },
        { hint: MEMBERSHIP_INDEX },
      )
      .exec();
  }

  /** Those of `userIds` whose username contains `search` (any case); read through `_id`, so the cost is bounded by the ids, not the site. */
  async idsWithUsername(
    userIds: readonly string[],
    search: string,
  ): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await this.users
      .find(
        { _id: { $in: userIds }, username: usernamePattern(search) },
        { _id: 1 },
      )
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }

  /** Every member, listed or not: the live count approvals check `slots` against. */
  countMembers(organizationId: string): Promise<number> {
    return this.users.countDocuments({ organizations: organizationId }).exec();
  }

  /** True when `slots` is set and the live member count has reached it. */
  async isFull(organizationId: string, slots: number | null): Promise<boolean> {
    return slots !== null && (await this.countMembers(organizationId)) >= slots;
  }

  async isMember(userId: string, organizationId: string): Promise<boolean> {
    return (
      (await this.users
        .exists({ _id: userId, organizations: organizationId })
        .exec()) !== null
    );
  }

  /** Compare-and-set on the whole ordered array: false when the memberships changed since `current` was read, so two parallel joins cannot both pass the cap. */
  async joinIfUnchanged(
    userId: string,
    current: readonly string[],
    organizationId: string,
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, organizations: [...current] },
        { $push: { organizations: organizationId } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Admins become members whatever the open-organization cap (legacy `organization_admin_update` signal). */
  async addMembers(
    userIds: readonly string[],
    organizationId: string,
  ): Promise<void> {
    if (userIds.length)
      await this.users
        .updateMany(
          { _id: { $in: userIds } },
          { $addToSet: { organizations: organizationId } },
        )
        .exec();
  }

  /** False when the user was not a member. */
  async remove(userId: string, organizationId: string): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, organizations: organizationId },
        { $pull: { organizations: organizationId } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Organization delete: every member loses the membership. */
  async removeAll(organizationId: string): Promise<void> {
    await this.users
      .updateMany(
        { organizations: organizationId },
        { $pull: { organizations: organizationId } },
      )
      .exec();
  }

  /** Profile edit: a reordering or a subset of `current`, compare-and-set like `joinIfUnchanged`. */
  async reorderIfUnchanged(
    userId: string,
    current: readonly string[],
    next: readonly string[],
  ): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne(
        { _id: userId, organizations: [...current] },
        { $set: { organizations: [...next] } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Legacy `CreateOrganization` put admins in the `Org Admin` group; skipped when no such group exists. */
  async grantGroup(
    userIds: readonly string[],
    groupName: string,
  ): Promise<void> {
    const group = await this.groups
      .findOne({ name: groupName }, { _id: 1 })
      .collation(CI)
      .lean()
      .exec();
    if (group && userIds.length)
      await this.users
        .updateMany(
          { _id: { $in: userIds } },
          { $addToSet: { groups: uuidStr(group._id) } },
        )
        .exec();
  }
}
