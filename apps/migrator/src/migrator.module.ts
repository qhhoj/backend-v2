import { Module } from '@nestjs/common';
import { DatabaseModule } from '@libs/database';
import { BackfillCommand, VerifyCommand } from './commands';
import { IdMap } from './id-map';
import { LegacySource } from './legacy-source';
import { mapperProviders } from './mappers';
import { MigrationService } from './migration.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    LegacySource,
    IdMap,
    MigrationService,
    ...mapperProviders,
    BackfillCommand,
    VerifyCommand,
  ],
})
export class MigratorModule {}
