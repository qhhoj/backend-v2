import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { problemJobs } from '@libs/problems';
import { PolygonAutoSyncService } from './polygon-autosync.service';
import type { AutoSyncSummary } from './polygon-autosync.service';

@Injectable()
export class PolygonAutoSyncProcessor extends JobProcessor<
  void,
  AutoSyncSummary
>(problemJobs.autoSync) {
  constructor(private readonly autoSync: PolygonAutoSyncService) {
    super();
  }

  run(): Promise<AutoSyncSummary> {
    return this.autoSync.run();
  }
}
