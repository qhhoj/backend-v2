import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { CONTEST_RESCORE_QUEUE } from '@libs/contests';
import {
  JudgingModule,
  PROBLEM_RESCORE_QUEUE,
  SUBMISSION_GRADED_QUEUE,
} from '@libs/judging';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { EventsModule } from '../events/events.module';
import { JudgesApiModule } from '../judges/judges-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionActionsController } from './actions/submission-actions.controller';
import { SubmissionActionsService } from './actions/submission-actions.service';
import { BatchLogRepository } from './batch/batch-log.repository';
import { BatchScopeService } from './batch/batch-scope.service';
import { SubmissionBatchController } from './batch/submission-batch.controller';
import { SubmissionBatchService } from './batch/submission-batch.service';
import { BestSubmissionsController } from './best/best-submissions.controller';
import { BestSubmissionsRepository } from './best/best-submissions.repository';
import { BestSubmissionsService } from './best/best-submissions.service';
import { SubmissionCreateController } from './create/submission-create.controller';
import { SubmissionCreateService } from './create/submission-create.service';
import { SubmissionStreamsController } from './streams/submission-streams.controller';
import { SubmissionStreamsService } from './streams/submission-streams.service';
import { ExternalRunsRepository } from './core/external-runs.repository';
import { SubmissionStatsService } from './core/submission-stats.service';
import { SubmissionsController } from './core/submissions.controller';
import { SubmissionsRepository } from './core/submissions.repository';
import { SubmissionsService } from './core/submissions.service';

@Module({
  imports: [
    ContestAccessModule,
    EventsModule,
    AuthModule,
    ProblemsApiModule,
    JudgesApiModule,
    JudgingModule,
    BullModule.registerQueue(
      { name: SUBMISSION_GRADED_QUEUE },
      { name: PROBLEM_RESCORE_QUEUE },
      { name: CONTEST_RESCORE_QUEUE },
    ),
  ],
  controllers: [
    SubmissionCreateController,
    SubmissionsController,
    SubmissionActionsController,
    SubmissionBatchController,
    SubmissionStreamsController,
    BestSubmissionsController,
  ],
  exports: [SubmissionsService, SubmissionsRepository, SubmissionBatchService],
  providers: [
    SubmissionsRepository,
    ExternalRunsRepository,
    SubmissionCreateService,
    SubmissionsService,
    SubmissionStatsService,
    SubmissionActionsService,
    RateLimitService,
    SubmissionStreamsService,
    BestSubmissionsRepository,
    BestSubmissionsService,
    BatchScopeService,
    BatchLogRepository,
    SubmissionBatchService,
  ],
})
export class SubmissionsApiModule {}
