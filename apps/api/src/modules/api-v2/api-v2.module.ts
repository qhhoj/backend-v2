import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ContestsApiModule } from '../contests/contests-api.module';
import { ContestAccessModule } from '../contests/contest-access.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { ApiV2ContestsController } from './api-v2-contests.controller';
import { ApiV2ContestsService } from './api-v2-contests.service';
import { ApiV2ProblemsController } from './api-v2-problems.controller';
import { ApiV2ProblemsService } from './api-v2-problems.service';
import { ApiV2SubmissionsController } from './api-v2-submissions.controller';
import { ApiV2SubmissionsService } from './api-v2-submissions.service';

@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ContestsApiModule,
    ProblemsApiModule,
    SubmissionsApiModule,
  ],
  controllers: [
    ApiV2ContestsController,
    ApiV2ProblemsController,
    ApiV2SubmissionsController,
  ],
  providers: [
    ApiV2ContestsService,
    ApiV2ProblemsService,
    ApiV2SubmissionsService,
  ],
})
export class ApiV2Module {}
