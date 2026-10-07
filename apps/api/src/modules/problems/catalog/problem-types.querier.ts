import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { ProblemType } from '@libs/database';
import { Model } from 'mongoose';

@Injectable()
export class ProblemTypesQuerier extends BaseCatalogQuerier<ProblemType> {
  constructor(
    @InjectModel(ProblemType.name) model: Model<ProblemType>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }
}
