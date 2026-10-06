import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { JudgingModule } from '@libs/judging';
import { JudgesApiModule } from '../judges/judges-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionCreateController } from './submission-create.controller';
import { SubmissionCreateService } from './submission-create.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [AuthModule, ProblemsApiModule, JudgesApiModule, JudgingModule],
  controllers: [SubmissionCreateController, SubmissionsController],
  providers: [
    SubmissionsRepository,
    SubmissionCreateService,
    SubmissionsService,
    RateLimitService,
  ],
})
export class SubmissionsApiModule {}
