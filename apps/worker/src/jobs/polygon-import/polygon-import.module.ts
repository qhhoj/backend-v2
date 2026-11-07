import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { JudgingModule, judgingJobs } from '@libs/judging';
import { DiscordWebhooksModule } from '@libs/community';
import {
  problemJobs,
  ProblemFilesModule,
  QuotaLedgerModule,
} from '@libs/problems';
import { ImportQuota } from './import-quota.service';
import { ImportSourceChecks } from './import-source-checks';
import { PandocService } from './pandoc.service';
import { PolygonImportProcessor } from './polygon-import.processor';
import { PolygonImportRepository } from './polygon-import.repository';
import { PolygonImportService } from './polygon-import.service';
import { PolygonSyncRunsRepository } from './polygon-sync-runs.repository';
import { RunningContestsRepository } from './running-contests.repository';
import { StandardPackageTests } from './standard-package-tests';
import { TestGenerationRepository } from './test-generation.repository';
import { TestGenerationService } from './test-generation.service';

@Module({
  imports: [
    JudgingModule,
    ProblemFilesModule,
    QuotaLedgerModule,
    DiscordWebhooksModule,
    JobsModule.register(
      problemJobs.polygonImport,
      problemJobs.pdf,
      problemJobs.sourceCheck,
      judgingJobs.problemRescore,
    ),
  ],
  providers: [
    PolygonImportProcessor,
    ImportQuota,
    ImportSourceChecks,
    PolygonImportService,
    PolygonImportRepository,
    PolygonSyncRunsRepository,
    RunningContestsRepository,
    PandocService,
    StandardPackageTests,
    TestGenerationService,
    TestGenerationRepository,
  ],
  exports: [TestGenerationService, TestGenerationRepository],
})
export class PolygonImportModule {}
