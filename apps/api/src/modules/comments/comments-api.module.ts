import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { BlogAccessModule } from '../blog/core/blog-access.module';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { DiscordWebhooksModule } from '@libs/community';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { TagsApiModule } from '../tags/tags-api.module';
import { CommentLocksRepository } from './core/comment-locks.repository';
import { CommentPagesService } from './core/comment-pages.service';
import { CommentsController } from './core/comments.controller';
import { CommentsRepository } from './core/comments.repository';
import { CommentsService } from './core/comments.service';
import { RecentCommentsService } from './core/recent-comments.service';
import { CommentAdminController } from './moderation/comment-admin.controller';
import { CommentAdminService } from './moderation/comment-admin.service';
import { CommentModerationController } from './moderation/comment-moderation.controller';
import { CommentModerationService } from './moderation/comment-moderation.service';
import { CommentPostingController } from './posting/comment-posting.controller';
import { CommentPostingService } from './posting/comment-posting.service';
import { CommentReportsController } from './reports/comment-reports.controller';
import { CommentReportsRepository } from './reports/comment-reports.repository';
import { CommentReportsService } from './reports/comment-reports.service';
import { CommentVotesController } from './votes/comment-votes.controller';
import { CommentVotesService } from './votes/comment-votes.service';

@Module({
  imports: [
    AuthModule,
    BlogAccessModule,
    ContestAccessModule,
    ProblemsApiModule,
    TagsApiModule,
    ContributionsModule,
    DiscordWebhooksModule,
  ],
  controllers: [
    CommentsController,
    CommentPostingController,
    CommentVotesController,
    CommentModerationController,
    CommentAdminController,
    CommentReportsController,
  ],
  providers: [
    CommentsRepository,
    CommentLocksRepository,
    CommentPagesService,
    CommentsService,
    CommentPostingService,
    CommentVotesService,
    CommentModerationService,
    CommentAdminService,
    RecentCommentsService,
    CommentReportsRepository,
    CommentReportsService,
    RateLimitService,
  ],
  exports: [
    CommentsRepository,
    CommentPagesService,
    CommentsService,
    RecentCommentsService,
  ],
})
export class CommentsApiModule {}
