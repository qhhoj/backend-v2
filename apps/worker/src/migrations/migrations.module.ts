import { Module } from '@nestjs/common';
import {
  ENV,
  EnvModule,
  RedisModule,
  StorageModule,
  workerConfig,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { ContestFieldsMigration } from './contest-fields/contest-fields.migration';
import { LanguageActiveFlagMigration } from './language-active-flag/language-active-flag.migration';
import { ParticipationRulesFieldsMigration } from './participation-rules-fields/participation-rules-fields.migration';
import { PolygonApiKeySealingMigration } from './polygon-api-key-sealing/polygon-api-key-sealing.migration';
import { ProblemVisibilityFlagsMigration } from './problem-visibility-flags/problem-visibility-flags.migration';
import { TestGenerationFeatureMigration } from './test-generation-feature/test-generation-feature.migration';
import { TicketStaffFlagMigration } from './ticket-staff-flag/ticket-staff-flag.migration';
import { UserLegacyFieldsMigration } from './user-legacy-fields/user-legacy-fields.migration';
import { ContestSummaryCleanupMigration } from './contest-summary-cleanup/contest-summary-cleanup.migration';
import { IeOverrideCleanupMigration } from './ie-override-cleanup/ie-override-cleanup.migration';
import { MIGRATIONS } from './migration';
import type { Migration } from './migration';
import { MigrationRunner } from './migration-runner.service';
import { PasswordVerificationBackfillMigration } from './password-verification-backfill/password-verification-backfill.migration';
import { PermissionRenameMigration } from './permission-rename/permission-rename.migration';
import { ProblemDataBytesMigration } from './problem-databytes/problem-databytes.migration';
import { ProblemDataBytesRepository } from './problem-databytes/problem-databytes.repository';
import { workerTuning } from '../worker-tuning';

/** Every migration, in the order they run. Append-only: a new one goes at the end. */
const IN_ORDER = [
  PermissionRenameMigration,
  IeOverrideCleanupMigration,
  ContestSummaryCleanupMigration,
  PasswordVerificationBackfillMigration,
  ProblemDataBytesMigration,
  ContestFieldsMigration,
  ParticipationRulesFieldsMigration,
  ProblemVisibilityFlagsMigration,
  TestGenerationFeatureMigration,
  UserLegacyFieldsMigration,
  LanguageActiveFlagMigration,
  TicketStaffFlagMigration,
  PolygonApiKeySealingMigration,
];

/** What `worker migrate` boots: data access only, no queue, processor or schedule, so nothing but the migrations touches the live site. */
@Module({
  imports: [
    EnvModule.forRoot(workerConfig, workerTuning),
    DatabaseModule.forRoot(ENV),
    RedisModule,
    StorageModule,
    ProblemFilesModule,
  ],
  providers: [
    ...IN_ORDER,
    ProblemDataBytesRepository,
    MigrationRunner,
    {
      provide: MIGRATIONS,
      useFactory: (...migrations: Migration[]) => migrations,
      inject: IN_ORDER,
    },
  ],
})
export class MigrationsModule {}
