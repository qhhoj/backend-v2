import { Module } from '@nestjs/common';
import { DatabaseModule } from '@libs/database';
import { BackfillCommand } from './commands/backfill.command';
import { VerifyCommand } from './commands/verify.command';
import { IdMapRepository } from './id-map.repository';
import { LegacySourceService } from './legacy-source.service';
import { mapperProviders } from './mappers';
import { MigrationService } from './migration.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    LegacySourceService,
    IdMapRepository,
    MigrationService,
    ...mapperProviders,
    BackfillCommand,
    VerifyCommand,
  ],
})
export class MigratorModule {}
