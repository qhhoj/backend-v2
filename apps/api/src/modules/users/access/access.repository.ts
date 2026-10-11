import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Group, User, uuidStr } from '@libs/database';
import { Model } from 'mongoose';
import type { UpdateQuery } from 'mongoose';

export interface GroupRow {
  id: string;
  name: string;
  permissions: string[];
}
const rowOf = (group: Group): GroupRow => ({
  id: uuidStr(group._id),
  name: group.name,
  permissions: group.permissions,
});

/** Additions and removals of one array field, applied atomically one after the other, so a concurrent `$addToSet` elsewhere is never undone. */
export interface SetChange {
  add?: string[];
  remove?: string[];
}

/** Groups (legacy Django `auth_group`, shown as roles) and the user fields the access screens write. */
@Injectable()
export class AccessRepository {
  constructor(
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async listGroups(): Promise<GroupRow[]> {
    const groups = await this.groups
      .find()
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1 })
      .lean()
      .exec();
    return groups.map(rowOf);
  }

  async findGroups(ids: string[]): Promise<GroupRow[]> {
    if (ids.length === 0) return [];
    const groups = await this.groups
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
    return groups.map(rowOf);
  }

  /** Members per group id, in one pass over `{groups}`. */
  async memberCounts(): Promise<Map<string, number>> {
    const rows = await this.users
      .aggregate<{ _id: string; count: number }>([
        { $match: { groups: { $ne: [] } } },
        { $unwind: '$groups' },
        { $group: { _id: '$groups', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.count]));
  }

  /** Through `{groups}`. */
  memberCount(groupId: string): Promise<number> {
    return this.users.countDocuments({ groups: groupId }).exec();
  }

  async createGroup(name: string, permissions: string[]): Promise<GroupRow> {
    return rowOf((await this.groups.create({ name, permissions })).toObject());
  }

  /** Null when the group is gone. */
  async changeGroup(
    id: string,
    name: string | undefined,
    permissions: SetChange,
  ): Promise<GroupRow | null> {
    await this.changeSets(
      this.groups,
      id,
      { permissions },
      name ? { name } : {},
    );
    const group = await this.groups.findById(id).lean().exec();
    return group && rowOf(group);
  }

  async changeUser(
    id: string,
    sets: { groups: SetChange; permissions: SetChange },
    flags: { isStaff?: boolean; isSuperuser?: boolean },
  ): Promise<void> {
    await this.changeSets(this.users, id, sets, flags);
  }

  /** `$set` and `$addToSet` in one update, then `$pull`: Mongo refuses `$addToSet` and `$pull` on one field in one update. */
  private async changeSets<Doc>(
    model: Model<Doc>,
    id: string,
    sets: Record<string, SetChange>,
    plain: Record<string, unknown>,
  ): Promise<void> {
    const fieldsOf = (pick: (change: SetChange) => string[] | undefined) =>
      Object.entries(sets).flatMap(([field, change]) => {
        const items = pick(change);
        return items?.length ? [[field, items] as const] : [];
      });
    const $set = Object.fromEntries(
      Object.entries(plain).filter(([, value]) => value !== undefined),
    );
    const added = fieldsOf((change) => change.add);
    const removed = fieldsOf((change) => change.remove);
    if (added.length || Object.keys($set).length)
      await model
        .updateOne({ _id: id }, {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(added.length
            ? {
                $addToSet: Object.fromEntries(
                  added.map(([field, items]) => [field, { $each: items }]),
                ),
              }
            : {}),
        } as UpdateQuery<Doc>)
        .exec();
    if (removed.length)
      await model
        .updateOne({ _id: id }, {
          $pull: Object.fromEntries(
            removed.map(([field, items]) => [field, { $in: items }]),
          ),
        } as UpdateQuery<Doc>)
        .exec();
  }
}
