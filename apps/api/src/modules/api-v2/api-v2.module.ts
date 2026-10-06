import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { ApiV2ProblemsController } from './api-v2-problems.controller';
import { ApiV2ProblemsService } from './api-v2-problems.service';
import { ApiV2SubmissionsController } from './api-v2-submissions.controller';
import { ApiV2SubmissionsService } from './api-v2-submissions.service';

@Module({
  imports: [AuthModule, ProblemsApiModule, SubmissionsApiModule],
  controllers: [ApiV2ProblemsController, ApiV2SubmissionsController],
  providers: [ApiV2ProblemsService, ApiV2SubmissionsService],
})
export class ApiV2Module {}
