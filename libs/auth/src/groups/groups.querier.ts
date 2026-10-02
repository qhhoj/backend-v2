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
    await this.resync();
    this.setupMongoStream(
      this.model,
      [],
      // eslint-disable-next-line @typescript-eslint/require-await
      async ({ fullDocument: g }) =>
        void (g && this.perms.set(uuidStr(g._id), g.permissions)),
    );
    this.forceResyncQuerier(
      () => this.resync(),
      CronExpression.EVERY_10_MINUTES,
    );
  }

  async resync() {
    this.perms = new Map(
      (await this.model.find().lean()).map((g) => [
        uuidStr(g._id),
        g.permissions,
      ]),
    );
  }

  permissionsOf(groupIds: string[]): string[] {
    return groupIds.flatMap((id) => this.perms.get(id) ?? []);
  }
}
