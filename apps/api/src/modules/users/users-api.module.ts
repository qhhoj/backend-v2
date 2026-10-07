import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { USER_DATA_QUEUE } from '@libs/community';
import { RateLimitService } from '@libs/common';
import { BlogApiModule } from '../blog/blog-api.module';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { UserDataController } from './data/user-data.controller';
import { UserDataService } from './data/user-data.service';
import { LeaderboardsController } from './leaderboards/leaderboards.controller';
import { LeaderboardsRepository } from './leaderboards/leaderboards.repository';
import { LeaderboardsService } from './leaderboards/leaderboards.service';
import { UserModerationController } from './moderation/user-moderation.controller';
import { UserModerationService } from './moderation/user-moderation.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { UserPagesController } from './pages/user-pages.controller';
import { UserPagesRepository } from './pages/user-pages.repository';
import { UserPagesService } from './pages/user-pages.service';

@Module({
  imports: [
    AuthModule,
    BlogApiModule,
    OrganizationsApiModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: USER_DATA_QUEUE }),
  ],
  controllers: [
    UserPagesController,
    LeaderboardsController,
    ProfileController,
    UserModerationController,
    UserDataController,
  ],
  providers: [
    LeaderboardsRepository,
    LeaderboardsService,
    UserPagesRepository,
    UserPagesService,
    ProfileService,
    UserModerationService,
    UserDataService,
    RateLimitService,
  ],
  exports: [LeaderboardsRepository, UserPagesRepository],
})
export class UsersApiModule {}
