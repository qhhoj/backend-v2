import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TestGeneration } from '@libs/database';
import type { Model } from 'mongoose';
import { fillMissing } from '../fill-missing';
import type { Migration } from '../migration';

/** Rows from before compile checks are test generations: the bridge's `feature ?? 'generate.polygon'` (L24 drops it). Writes only `feature`, never what a claim compares. */
@Injectable()
export class TestGenerationFeatureMigration implements Migration {
  readonly id = '2026-11-06-test-generation-feature';

  constructor(
    @InjectModel(TestGeneration.name)
    private readonly generations: Model<TestGeneration>,
  ) {}

  run(): Promise<number> {
    return fillMissing(this.generations.collection, {
      feature: 'generate.polygon',
    });
  }
}
