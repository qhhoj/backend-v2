import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ContestParticipation } from '@libs/database';
import type { Model } from 'mongoose';
import { fillMissing } from '../fill-missing';
import type { Migration } from '../migration';

/**
 * Participations from before rules existed get the schema's "no rules asked" (null). The join's
 * `rulesAcceptedRevision ?? -1` stays: null is a value the schema writes, and it reads as older than any revision.
 */
@Injectable()
export class ParticipationRulesFieldsMigration implements Migration {
  readonly id = '2026-11-06-participation-rules-fields';

  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
  ) {}

  run(): Promise<number> {
    return fillMissing(this.participations.collection, {
      rulesAcceptedAt: null,
      rulesAcceptedRevision: null,
    });
  }
}
