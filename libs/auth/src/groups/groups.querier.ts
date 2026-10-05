import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { BaseMongoStreamQuerier } from '@libs/common';
import { Group, uuidStr } from '@libs/database';
import { Model } from 'mongoose';

@Injectable()
export class GroupsQuerier
  extends BaseMongoStreamQuerier
  implements OnModuleInit
{
  private perms = new Map<string, string[]>();

  constructor(
    @InjectModel(Group.name) private readonly model: Model<Group>,
    scheduler: SchedulerRegistry,
  ) {
    super(scheduler);
  }

  async onModuleInit() {
    await this.setupMongoStream(
      this.model,
      [],
      // eslint-disable-next-line @typescript-eslint/require-await
      async ({ fullDocument: group }) =>
        void (group && this.perms.set(uuidStr(group._id), group.permissions)),
      () => this.resync(),
    );
    this.forceResyncQuerier(
      () => this.resync(),
      CronExpression.EVERY_10_MINUTES,
    );
  }

  async resync() {
    this.perms = new Map(
      (await this.model.find().lean()).map((group) => [
        uuidStr(group._id),
        group.permissions,
      ]),
    );
  }

  /** The known groups among `groupIds`, as the permission holders `permissionsOf` takes. */
  groupsOf(groupIds: string[]): Array<{ permissions: string[] }> {
    return groupIds.flatMap((id) => {
      const permissions = this.perms.get(id);
      return permissions ? [{ permissions }] : [];
    });
  }
}
