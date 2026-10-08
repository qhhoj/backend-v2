import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { JudgingModule, SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { EventsModule } from '../events/events.module';
import { JudgesApiModule } from '../judges/judges-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionActionsController } from './actions/submission-actions.controller';
import { SubmissionActionsService } from './actions/submission-actions.service';
import { SubmissionCreateController } from './create/submission-create.controller';
import { SubmissionCreateService } from './create/submission-create.service';
import { SubmissionStreamsController } from './streams/submission-streams.controller';
import { SubmissionStreamsService } from './streams/submission-streams.service';
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
    BullModule.registerQueue({ name: SUBMISSION_GRADED_QUEUE }),
  ],
  controllers: [
    SubmissionCreateController,
    SubmissionsController,
    SubmissionActionsController,
    SubmissionStreamsController,
  ],
  exports: [SubmissionsService, SubmissionsRepository],
  providers: [
    SubmissionsRepository,
    SubmissionCreateService,
    SubmissionsService,
    SubmissionStatsService,
    SubmissionActionsService,
    RateLimitService,
    SubmissionStreamsService,
  ],
})
export class SubmissionsApiModule {}
