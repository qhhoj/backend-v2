import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EnvModule, QueueModule, RedisModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import {
  SUBMISSION_GRADED_QUEUE,
  SubmissionEventsService,
} from '@libs/judging';
import { BRIDGE_TIMINGS, DEFAULT_BRIDGE_TIMINGS } from './bridge-timings';
import { DispatcherService } from './dispatch/dispatcher.service';
import { GenerationsRepository } from './generations/generations.repository';
import { GenerationsService } from './generations/generations.service';
import { JudgesRepository } from './judges/judges.repository';
import { JudgeLinkServer } from './link/judge-link.server';
import { GenerationTransfer } from './link/generation-transfer';
import { SourceFetch } from './link/source-fetch';
import { RunWritesRepository } from './submissions/run-writes.repository';
import { RunsService } from './submissions/runs.service';
import { SubmissionsRepository } from './submissions/submissions.repository';

/** The judge side of the bridge: the gRPC link, dispatch and the run writes. `BridgeModule` adds the api's commands and the start/stop/resync loop. */
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
    RunWritesRepository,
    SubmissionEventsService,
    RunsService,
    GenerationsRepository,
    GenerationsService,
    DispatcherService,
    JudgesRepository,
    SourceFetch,
    GenerationTransfer,
    JudgeLinkServer,
  ],
  exports: [
    BRIDGE_TIMINGS,
    SubmissionsRepository,
    RunsService,
    GenerationsRepository,
    GenerationsService,
    DispatcherService,
    GenerationsRepository,
    JudgesRepository,
    JudgeLinkServer,
  ],
})
export class BridgeCoreModule {}
