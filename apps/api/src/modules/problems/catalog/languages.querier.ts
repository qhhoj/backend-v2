import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCatalogQuerier } from '@libs/common';
import { isLanguageActive, Language } from '@libs/database';
import { Model } from 'mongoose';

@Injectable()
export class LanguagesQuerier extends BaseCatalogQuerier<Language> {
  constructor(
    @InjectModel(Language.name) model: Model<Language>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }

  /** Languages every new problem allows (legacy `include_in_problem`), inactive ones left out. */
  includedInProblems(): Language[] {
    return this.all().filter(
      (language) => language.includeInProblem && isLanguageActive(language),
    );
  }
}
