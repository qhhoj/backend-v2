import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { JudgingModule } from '@libs/judging';
import { JudgesApiModule } from '../judges/judges-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionCreateController } from './submission-create.controller';
import { SubmissionCreateService } from './submission-create.service';
import { SubmissionsRepository } from './submissions.repository';

@Module({
  imports: [AuthModule, ProblemsApiModule, JudgesApiModule, JudgingModule],
  controllers: [SubmissionCreateController],
  providers: [SubmissionsRepository, SubmissionCreateService, RateLimitService],
})
export class SubmissionsApiModule {}
