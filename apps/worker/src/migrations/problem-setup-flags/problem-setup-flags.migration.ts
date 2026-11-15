import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem, SETUP_REFRESH_PIPELINE } from '@libs/database';
import type { Model } from 'mongoose';
import type { Migration } from '../migration';

/** Stores `setup` and `isSetupUnfinished` on problems written before the admin list showed readiness (new writes keep them current). */
@Injectable()
export class ProblemSetupFlagsMigration implements Migration {
  readonly id = '2026-11-15-problem-setup-flags';

  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** Only rows without the flags, through the raw collection: no hooks, and `updatedAt` stays as it was. */
  async run(): Promise<number> {
    const { modifiedCount } = await this.problems.collection.updateMany(
      { setup: { $exists: false } },
      SETUP_REFRESH_PIPELINE,
    );
    return modifiedCount;
  }
}
