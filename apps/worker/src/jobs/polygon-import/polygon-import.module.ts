import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { PDF_QUEUE, POLYGON_QUEUE, ProblemFilesModule } from '@libs/problems';
import { PandocService } from './pandoc.service';
import { PolygonImportProcessor } from './polygon-import.processor';
import { PolygonImportRepository } from './polygon-import.repository';
import { PolygonImportService } from './polygon-import.service';
import { PolygonSyncRunsRepository } from './polygon-sync-runs.repository';

@Module({
  imports: [
    ProblemFilesModule,
    BullModule.registerQueue(
      { name: POLYGON_QUEUE },
      { name: PDF_QUEUE },
      { name: PROBLEM_RESCORE_QUEUE },
    ),
  ],
  providers: [
    PolygonImportProcessor,
    PolygonImportService,
    PolygonImportRepository,
    PolygonSyncRunsRepository,
    PandocService,
  ],
})
export class PolygonImportModule {}
