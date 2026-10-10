import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { JOB_RETRY } from '@libs/judging';
import {
  POLYGON_AUTOSYNC_JOB,
  POLYGON_AUTOSYNC_PATTERN,
  POLYGON_AUTOSYNC_QUEUE,
  POLYGON_AUTOSYNC_SCHEDULER,
} from '@libs/problems';
import { PolygonAutoSyncService } from './polygon-autosync.service';
import type { AutoSyncSummary } from './polygon-autosync.service';

@Processor(POLYGON_AUTOSYNC_QUEUE, { concurrency: 1 })
export class PolygonAutoSyncProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(PolygonAutoSyncProcessor.name);

  constructor(
    private readonly autoSync: PolygonAutoSyncService,
    @InjectQueue(POLYGON_AUTOSYNC_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent). A pattern schedule queues no job at boot. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      POLYGON_AUTOSYNC_SCHEDULER,
      { pattern: POLYGON_AUTOSYNC_PATTERN },
      {
        name: POLYGON_AUTOSYNC_JOB,
        opts: { ...JOB_RETRY, removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  process(): Promise<AutoSyncSummary> {
    return this.autoSync.run();
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Polygon auto-sync failed: ${error.message}`);
  }
}
