import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { USER_DATA_QUEUE } from '@libs/community';
import { RateLimitService } from '@libs/common';
import { AuthApiModule } from '../auth/auth-api.module';
import { BlogApiModule } from '../blog/blog-api.module';
import { CommentsApiModule } from '../comments/comments-api.module';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { UserDataController } from './data/user-data.controller';
import { UserDataService } from './data/user-data.service';
import { LeaderboardsController } from './leaderboards/leaderboards.controller';
import { LeaderboardsRepository } from './leaderboards/leaderboards.repository';
import { LeaderboardsService } from './leaderboards/leaderboards.service';
import { UserAdminController } from './admin/user-admin.controller';
import { UserAdminRepository } from './admin/user-admin.repository';
import { UserAdminService } from './admin/user-admin.service';
import { AccessController } from './access/access.controller';
import { AccessRepository } from './access/access.repository';
import { GroupsAdminService } from './access/groups-admin.service';
import { UserAccessService } from './access/user-access.service';
import { UserCreationController } from './creation/user-creation.controller';
import { UserCreationService } from './creation/user-creation.service';
import { UserRenameService } from './editing/user-rename.service';
import { UserCredentialsService } from './editing/user-credentials.service';
import { UserEditingController } from './editing/user-editing.controller';
import { UserMembershipEditor } from './editing/user-membership-editor';
import { UserProfileEditingService } from './editing/user-profile-editing.service';
import { UserModerationController } from './moderation/user-moderation.controller';
import { UserModerationService } from './moderation/user-moderation.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { UserPagesController } from './pages/user-pages.controller';
import { UserPagesRepository } from './pages/user-pages.repository';
import { UserPagesService } from './pages/user-pages.service';
import { UserSuggestionsController } from './suggestions/user-suggestions.controller';
import { UserSuggestionsRepository } from './suggestions/user-suggestions.repository';
import { UserSuggestionsService } from './suggestions/user-suggestions.service';

@Module({
  imports: [
    AuthModule,
    AuthApiModule,
    BlogApiModule,
    CommentsApiModule,
    ContestAccessModule,
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
    UserAdminController,
    UserEditingController,
    UserCreationController,
    AccessController,
    UserSuggestionsController,
  ],
  providers: [
    LeaderboardsRepository,
    LeaderboardsService,
    UserPagesRepository,
    UserPagesService,
    ProfileService,
    UserModerationService,
    UserDataService,
    UserAdminRepository,
    UserAdminService,
    UserProfileEditingService,
    UserMembershipEditor,
    UserRenameService,
    UserCreationService,
    UserCredentialsService,
    AccessRepository,
    GroupsAdminService,
    UserAccessService,
    UserSuggestionsRepository,
    UserSuggestionsService,
    RateLimitService,
  ],
  exports: [LeaderboardsRepository, UserPagesRepository],
})
export class UsersApiModule {}
