import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EnvModule, QueueModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import { BRIDGE_TIMINGS, DEFAULT_BRIDGE_TIMINGS } from './bridge-timings';
import { GradingService } from './submissions/grading.service';
import { SubmissionsRepository } from './submissions/submissions.repository';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    QueueModule,
    BullModule.registerQueue({ name: SUBMISSION_GRADED_QUEUE }),
  ],
  providers: [
    { provide: BRIDGE_TIMINGS, useValue: DEFAULT_BRIDGE_TIMINGS },
    SubmissionsRepository,
    GradingService,
  ],
})
export class BridgeModule {}
