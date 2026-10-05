import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { Tag, uuidStr } from '@libs/database';
import { Model } from 'mongoose';

/** `groupId` is a BSON UUID in the loaded documents; every read returns it as a string. */
const withGroupIdString = (tag: Tag): Tag => ({
  ...tag,
  groupId: uuidStr(tag.groupId),
});

@Injectable()
export class TagsQuerier extends BaseCatalogQuerier<Tag> {
  constructor(
    @InjectModel(Tag.name) model: Model<Tag>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }

  override all(): Tag[] {
    return super.all().map(withGroupIdString);
  }

  override byId(id: string): Tag | null {
    const tag = super.byId(id);
    return tag && withGroupIdString(tag);
  }

  override byIds(ids: string[]): Tag[] {
    return super.byIds(ids).map(withGroupIdString);
  }

  byCode(code: string): Tag | null {
    return this.all().find((tag) => tag.code === code) ?? null;
  }

  byGroup(groupId: string): Tag[] {
    return this.all().filter((tag) => tag.groupId === groupId);
  }
}
