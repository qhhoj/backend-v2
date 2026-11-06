import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem } from '@libs/database';
import type { Model } from 'mongoose';
import { fillMissing } from '../fill-missing';
import type { Migration } from '../migration';

/** Backs the editor's visibility guard that reads a missing flag as false (`flagIs`, L24 drops it). */
@Injectable()
export class ProblemVisibilityFlagsMigration implements Migration {
  readonly id = '2026-11-06-problem-visibility-flags';

  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  run(): Promise<number> {
    return fillMissing(this.problems.collection, {
      isPublic: false,
      isOrganizationPrivate: false,
    });
  }
}
