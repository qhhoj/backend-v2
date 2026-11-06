import { Module } from '@nestjs/common';
import { EnvModule, RedisModule, StorageModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { ContestSummaryCleanupMigration } from './contest-summary-cleanup/contest-summary-cleanup.migration';
import { IeOverrideCleanupMigration } from './ie-override-cleanup/ie-override-cleanup.migration';
import { MIGRATIONS } from './migration';
import type { Migration } from './migration';
import { MigrationRunner } from './migration-runner.service';
import { PasswordVerificationBackfillMigration } from './password-verification-backfill/password-verification-backfill.migration';
import { PermissionRenameMigration } from './permission-rename/permission-rename.migration';
import { ProblemDataBytesMigration } from './problem-databytes/problem-databytes.migration';
import { ProblemDataBytesRepository } from './problem-databytes/problem-databytes.repository';

/** Every migration, in the order they run; a new one goes at the end. The size backfill scans every data directory, so it stays last. */
const IN_ORDER = [
  PermissionRenameMigration,
  IeOverrideCleanupMigration,
  ContestSummaryCleanupMigration,
  PasswordVerificationBackfillMigration,
  ProblemDataBytesMigration,
];

/** What `worker migrate` boots: data access only, no queue, processor or schedule, so nothing but the migrations touches the live site. */
@Module({
  imports: [
    EnvModule,
    DatabaseModule,
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
