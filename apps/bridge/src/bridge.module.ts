import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EnvModule, QueueModule, RedisModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import {
  SUBMISSION_GRADED_QUEUE,
  SubmissionEventsService,
} from '@libs/judging';
import { BRIDGE_TIMINGS, DEFAULT_BRIDGE_TIMINGS } from './bridge-timings';
import { CommandsService } from './dispatch/commands.service';
import { DispatchService } from './dispatch/dispatch.service';
import { JudgeServerService } from './judges/judge-server.service';
import { JudgesRepository } from './judges/judges.repository';
import { BridgeService } from './bridge.service';
import { GradingService } from './submissions/grading.service';
import { SubmissionsRepository } from './submissions/submissions.repository';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    QueueModule,
    RedisModule,
    BullModule.registerQueue({ name: SUBMISSION_GRADED_QUEUE }),
  ],
  providers: [
    { provide: BRIDGE_TIMINGS, useValue: DEFAULT_BRIDGE_TIMINGS },
    SubmissionsRepository,
    SubmissionEventsService,
    GradingService,
    DispatchService,
    CommandsService,
    JudgesRepository,
    JudgeServerService,
    BridgeService,
  ],
})
export class BridgeModule {}
