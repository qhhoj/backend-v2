import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { ContestTag } from '@libs/database';
import { Model } from 'mongoose';

/** The whole tag catalogue in memory (a few dozen rows), resynced like the other catalogues. */
@Injectable()
export class ContestTagsQuerier extends BaseCatalogQuerier<ContestTag> {
  constructor(
    @InjectModel(ContestTag.name) model: Model<ContestTag>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }

  /** Catalogue order: `order`, then slug. */
  ordered(): ContestTag[] {
    return this.all().sort(
      (left, right) =>
        left.order - right.order || left.slug.localeCompare(right.slug),
    );
  }

  hasSlug(slug: string): boolean {
    return this.all().some((tag) => tag.slug === slug);
  }
}
