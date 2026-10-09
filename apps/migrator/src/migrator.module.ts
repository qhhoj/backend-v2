import { Module } from '@nestjs/common';
import { DatabaseModule } from '@libs/database';
import { AuditService } from './audit.service';
import { AuditCommand } from './commands/audit.command';
import { BackfillCommand } from './commands/backfill.command';
import { FinishCommand } from './commands/finish.command';
import { VerifyCommand } from './commands/verify.command';
import { IdMapRepository } from './id-map.repository';
import { LegacySourceService } from './legacy-source.service';
import { mapperProviders } from './mappers';
import { MigrationService } from './migration.service';
import { MigrationStateService } from './migration-state.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    LegacySourceService,
    IdMapRepository,
    MigrationService,
    ...mapperProviders,
    MigrationStateService,
    BackfillCommand,
    FinishCommand,
    VerifyCommand,
    AuditService,
    AuditCommand,
  ],
})
export class MigratorModule {}
