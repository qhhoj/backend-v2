import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { License } from '@libs/database';
import { Model } from 'mongoose';

@Injectable()
export class LicensesQuerier extends BaseCatalogQuerier<License> {
  constructor(
    @InjectModel(License.name) model: Model<License>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }
}
