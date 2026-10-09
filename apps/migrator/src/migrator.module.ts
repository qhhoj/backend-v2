import { Module } from '@nestjs/common';
import { DatabaseModule } from '@libs/database';
import { AuditService } from './audit.service';
import { AuditCommand } from './commands/audit.command';
import { BackfillCommand } from './commands/backfill.command';
import { CheckFilesCommand } from './commands/check-files.command';
import { CheckIntegrityCommand } from './commands/check-integrity.command';
import { RecomputeCommand } from './commands/recompute.command';
import { FinishCommand } from './commands/finish.command';
import { VerifyCommand } from './commands/verify.command';
import { StampDataVersionsCommand } from './commands/stamp-data-versions.command';
import { CountDataShapesCommand } from './commands/count-data-shapes.command';
import { PruneLanguagesCommand } from './commands/prune-languages.command';
import { FileCheckService } from './file-check.service';
import { GrantPermissionsCommand } from './commands/grant-permissions.command';
import {
  GrantPermissionsService,
  PERMISSION_GRANTS_TOKEN,
} from './grant-permissions.service';
import { PERMISSION_GRANTS } from './permission-grants';
import { IdMapRepository } from './id-map.repository';
import { IntegrityCheckService } from './integrity-check.service';
import { LegacySourceService } from './legacy-source.service';
import { mapperProviders } from './mappers';
import { MigrationService } from './migration.service';
import { MigrationStateService } from './migration-state.service';
import { RecomputeService } from './recompute.service';

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
    StampDataVersionsCommand,
    CountDataShapesCommand,
    PruneLanguagesCommand,
    AuditService,
    AuditCommand,
    RecomputeService,
    RecomputeCommand,
    FileCheckService,
    CheckFilesCommand,
    IntegrityCheckService,
    CheckIntegrityCommand,
    GrantPermissionsService,
    GrantPermissionsCommand,
    { provide: PERMISSION_GRANTS_TOKEN, useValue: PERMISSION_GRANTS },
  ],
})
export class MigratorModule {}
