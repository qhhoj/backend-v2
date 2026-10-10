import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { POLYGON_AUTOSYNC_QUEUE, POLYGON_QUEUE } from '@libs/problems';
import { PolygonAutoSyncProcessor } from './polygon-autosync.processor';
import { PolygonAutoSyncRepository } from './polygon-autosync.repository';
import { PolygonAutoSyncService } from './polygon-autosync.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: POLYGON_AUTOSYNC_QUEUE },
      { name: POLYGON_QUEUE },
    ),
  ],
  providers: [
    PolygonAutoSyncProcessor,
    PolygonAutoSyncService,
    PolygonAutoSyncRepository,
  ],
})
export class PolygonAutoSyncModule {}
