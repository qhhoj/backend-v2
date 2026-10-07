import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { JudgingModule, SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import { ContestAccessModule } from '../contests/contest-access.module';
import { JudgesApiModule } from '../judges/judges-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionActionsController } from './submission-actions.controller';
import { SubmissionActionsService } from './submission-actions.service';
import { SubmissionCreateController } from './submission-create.controller';
import { SubmissionCreateService } from './submission-create.service';
import { DEFAULT_STREAM_LIMITS, STREAM_LIMITS } from './rate-limits';
import { SubmissionStreamsController } from './submission-streams.controller';
import { SubmissionStreamsService } from './submission-streams.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [
    ContestAccessModule,
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
    SubmissionActionsService,
    RateLimitService,
    SubmissionStreamsService,
    { provide: STREAM_LIMITS, useValue: DEFAULT_STREAM_LIMITS },
  ],
})
export class SubmissionsApiModule {}
