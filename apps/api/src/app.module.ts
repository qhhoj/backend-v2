import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  EnvModule,
  QueueModule,
  RedisModule,
  StorageModule,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { SettingsModule } from '@libs/settings';
import { MailModule } from './modules/mail/mail.module';
import { AuthApiModule } from './modules/auth/auth-api.module';
import { JudgesApiModule } from './modules/judges/judges-api.module';
import { OrganizationsApiModule } from './modules/organizations/organizations-api.module';
import { ProblemsApiModule } from './modules/problems/problems-api.module';
import { BlogApiModule } from './modules/blog/blog-api.module';
import { CommentsApiModule } from './modules/comments/comments-api.module';
import { HomeApiModule } from './modules/home/home-api.module';
import { ContributionsModule } from './modules/contributions/contributions.module';
import { ContestsApiModule } from './modules/contests/contests-api.module';
import { SimilarityApiModule } from './modules/similarity/similarity-api.module';
import { SubmissionsApiModule } from './modules/submissions/submissions-api.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsApiModule } from './modules/settings/settings-api.module';
import { TicketsApiModule } from './modules/tickets/tickets-api.module';
import { NotificationsApiModule } from './modules/notifications/notifications-api.module';
import { NotificationStreamsModule } from './modules/notifications/streams/notification-streams.module';
import { SeoApiModule } from './modules/seo/seo-api.module';
import { SiteApiModule } from './modules/site/site-api.module';
import { TagsApiModule } from './modules/tags/tags-api.module';
import { UsersApiModule } from './modules/users/users-api.module';
import { UserActivityModule } from './modules/user-activity/user-activity.module';
import { ShortLinksModule } from './modules/short-links/short-links.module';
import { SyncModule } from './modules/sync/sync.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    RedisModule,
    SettingsModule,
    QueueModule,
    MailModule,
    StorageModule,
    ProblemFilesModule,
    ScheduleModule.forRoot(),
    AuthApiModule,
    ProblemsApiModule,
    TagsApiModule,
    JudgesApiModule,
    SubmissionsApiModule,
    ContestsApiModule,
    SimilarityApiModule,
    OrganizationsApiModule,
    UsersApiModule,
    ContributionsModule,
    BlogApiModule,
    CommentsApiModule,
    TicketsApiModule,
    NotificationsApiModule,
    NotificationStreamsModule,
    HomeApiModule,
    SettingsApiModule,
    AuditModule,
    SiteApiModule,
    SeoApiModule,
    UserActivityModule,
    ShortLinksModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
