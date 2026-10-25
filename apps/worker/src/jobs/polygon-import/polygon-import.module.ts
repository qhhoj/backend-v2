import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JudgingModule, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { DiscordWebhooksModule } from '@libs/community';
import {
  PDF_QUEUE,
  POLYGON_QUEUE,
  ProblemFilesModule,
  SOURCE_CHECK_QUEUE,
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
    BullModule.registerQueue(
      { name: POLYGON_QUEUE },
      { name: PDF_QUEUE },
      { name: PROBLEM_RESCORE_QUEUE },
      { name: SOURCE_CHECK_QUEUE },
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
