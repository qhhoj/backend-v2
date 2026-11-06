import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Contest } from '@libs/database';
import type { Model } from 'mongoose';
import { fillMissing } from '../fill-missing';
import type { Migration } from '../migration';

/** Contest fields a row written before they existed lacks, at the schema default every hydrated read already sees. */
export const CONTEST_FIELD_DEFAULTS = {
  publishAfterEnd: false,
  publishAfterEndBy: null,
  autoPublishOutcome: null,
  organizations: [],
  isVisible: false,
  isPrivate: false,
  isOrganizationPrivate: false,
  rules: '',
  rulesHtml: '',
  rulesRevision: 0,
};

/** Backs the reads that still accept a missing field: the publish sweep's `autoPublishOutcome ?? null`, and the editor's `$ne: true`, `organizations.0` and `rules: ['', null]` guards (L24 drops them). */
@Injectable()
export class ContestFieldsMigration implements Migration {
  readonly id = '2026-11-06-contest-fields';

  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  run(): Promise<number> {
    return fillMissing(this.contests.collection, CONTEST_FIELD_DEFAULTS);
  }
}
