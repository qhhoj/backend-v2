import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs } from '@libs/problems';
import { RunningContestsRepository } from '../polygon-import/running-contests.repository';
import { PolygonAutoSyncProcessor } from './polygon-autosync.processor';
import { PolygonAutoSyncRepository } from './polygon-autosync.repository';
import { PolygonAutoSyncService } from './polygon-autosync.service';

@Module({
  imports: [
    JobsModule.register(problemJobs.autoSync, problemJobs.autoSyncImport),
  ],
  providers: [
    PolygonAutoSyncProcessor,
    PolygonAutoSyncService,
    PolygonAutoSyncRepository,
    RunningContestsRepository,
  ],
})
export class PolygonAutoSyncModule {}
