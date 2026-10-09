import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Group, User, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';

const STAFF_PERMISSION = 'judge.change_ticket';

/** Who is alerted about tickets nobody is assigned to. */
@Injectable()
export class TicketStaffRepository {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Group.name) private readonly groups: Model<Group>,
  ) {}

  /** Active users holding `judge.change_ticket` directly or through a group, oldest accounts first, at most `limit`. Superusers are not included on their own: they hold every permission, so counting them would alert all of them. Through `{permissions}` and `{groups}`. */
  async holders(limit: number): Promise<string[]> {
    const groupIds = (
      await this.groups
        .find({ permissions: STAFF_PERMISSION }, { _id: 1 })
        .lean()
        .exec()
    ).map((group) => uuidStr(group._id));
    const rows = await this.users
      .find(
        {
          isActive: true,
          $or: [
            { permissions: STAFF_PERMISSION },
            { groups: { $in: groupIds } },
          ],
        },
        { _id: 1 },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }
}
