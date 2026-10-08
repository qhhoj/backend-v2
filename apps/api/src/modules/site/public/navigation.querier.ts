import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { NavigationItem } from '@libs/database';
import { Model } from 'mongoose';

/** The whole navigation bar in memory (a handful of rows, read on every page load). */
@Injectable()
export class NavigationQuerier extends BaseCatalogQuerier<NavigationItem> {
  constructor(
    @InjectModel(NavigationItem.name) model: Model<NavigationItem>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }

  ordered(): NavigationItem[] {
    return this.all().sort(
      (left, right) =>
        left.order - right.order || left.key.localeCompare(right.key),
    );
  }
}
