import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Language } from '@libs/database';
import type { Model } from 'mongoose';
import { fillMissing } from '../fill-missing';
import type { Migration } from '../migration';

/** Languages from before `isActive` existed are active: `isLanguageActive` and the signup default's `$ne: false` (L24 drops them). */
@Injectable()
export class LanguageActiveFlagMigration implements Migration {
  readonly id = '2026-11-06-language-active-flag';

  constructor(
    @InjectModel(Language.name) private readonly languages: Model<Language>,
  ) {}

  run(): Promise<number> {
    return fillMissing(this.languages.collection, { isActive: true });
  }
}
