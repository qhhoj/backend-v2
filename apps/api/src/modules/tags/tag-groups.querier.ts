import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { TagGroup } from '@libs/database';
import { Model } from 'mongoose';

@Injectable()
export class TagGroupsQuerier extends BaseCatalogQuerier<TagGroup> {
  constructor(
    @InjectModel(TagGroup.name) model: Model<TagGroup>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }
}
