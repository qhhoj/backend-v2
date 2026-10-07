import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ContestsApiModule } from '../contests/contests-api.module';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { UsersApiModule } from '../users/users-api.module';
import { ApiV2ContestsController } from './contests/api-v2-contests.controller';
import { ApiV2ContestsService } from './contests/api-v2-contests.service';
import { ApiV2OrganizationsController } from './organizations/api-v2-organizations.controller';
import { ApiV2OrganizationsService } from './organizations/api-v2-organizations.service';
import { ApiV2ProblemsController } from './problems/api-v2-problems.controller';
import { ApiV2ProblemsService } from './problems/api-v2-problems.service';
import { ApiV2SubmissionsController } from './submissions/api-v2-submissions.controller';
import { ApiV2SubmissionsService } from './submissions/api-v2-submissions.service';
import { ApiV2UsersController } from './users/api-v2-users.controller';
import { ApiV2UsersService } from './users/api-v2-users.service';

@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ContestsApiModule,
    OrganizationsApiModule,
    ProblemsApiModule,
    SubmissionsApiModule,
    UsersApiModule,
  ],
  controllers: [
    ApiV2ContestsController,
    ApiV2OrganizationsController,
    ApiV2ProblemsController,
    ApiV2SubmissionsController,
    ApiV2UsersController,
  ],
  providers: [
    ApiV2ContestsService,
    ApiV2OrganizationsService,
    ApiV2ProblemsService,
    ApiV2SubmissionsService,
    ApiV2UsersService,
  ],
})
export class ApiV2Module {}
