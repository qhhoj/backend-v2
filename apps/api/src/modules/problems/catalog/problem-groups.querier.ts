import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { ProblemGroup } from '@libs/database';
import { Model } from 'mongoose';

@Injectable()
export class ProblemGroupsQuerier extends BaseCatalogQuerier<ProblemGroup> {
  constructor(
    @InjectModel(ProblemGroup.name) model: Model<ProblemGroup>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }
}
