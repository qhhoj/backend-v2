import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
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
  imports: [AuthModule, OrganizationsApiModule, ProblemsApiModule],
  controllers: [
    UserPagesController,
    LeaderboardsController,
    ProfileController,
    UserModerationController,
  ],
  providers: [
    LeaderboardsRepository,
    LeaderboardsService,
    UserPagesRepository,
    UserPagesService,
    ProfileService,
    UserModerationService,
  ],
})
export class UsersApiModule {}
