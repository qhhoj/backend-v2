import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { MiscConfig } from '@libs/database';
import { Model } from 'mongoose';

/** Served to everyone through `GET /site`: never store secrets in misc config. */
@Injectable()
export class MiscConfigQuerier extends BaseCatalogQuerier<MiscConfig> {
  constructor(
    @InjectModel(MiscConfig.name) model: Model<MiscConfig>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }

  asRecord(): Record<string, string> {
    return Object.fromEntries(this.all().map((item) => [item.key, item.value]));
  }
}
