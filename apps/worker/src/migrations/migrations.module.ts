import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ENV,
  EnvModule,
  RedisModule,
  StorageModule,
  workerConfig,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { MIGRATIONS } from './migration';
import type { Migration } from './migration';
import { MigrationRunner } from './migration-runner.service';
import { workerTuning } from '../worker-tuning';

/** Every migration, in the order they run. Append-only: a new one goes at the end. */
const IN_ORDER: Type<Migration>[] = [];

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
    MigrationRunner,
    {
      provide: MIGRATIONS,
      useFactory: (...migrations: Migration[]) => migrations,
      inject: IN_ORDER,
    },
  ],
})
export class MigrationsModule {}
