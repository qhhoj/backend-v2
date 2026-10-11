import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { CommentsApiModule } from '../comments/comments-api.module';
import { DiscordModule } from '../discord/discord.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { BlogAccessModule } from './core/blog-access.module';
import { BlogPostsController } from './core/blog-posts.controller';
import { BlogDraftsController } from './drafts/blog-drafts.controller';
import { BlogDraftsService } from './drafts/blog-drafts.service';
import { BlogPostsService } from './core/blog-posts.service';
import { BlogEditingController } from './editing/blog-editing.controller';
import { BlogEditingService } from './editing/blog-editing.service';
import { BlogModerationController } from './moderation/blog-moderation.controller';
import { BlogModerationService } from './moderation/blog-moderation.service';
import { BlogVotesController } from './votes/blog-votes.controller';
import { BlogVotesService } from './votes/blog-votes.service';
import { OrganizationPostsController } from './core/organization-posts.controller';

@Module({
  imports: [
    AuthModule,
    BlogAccessModule,
    CommentsApiModule,
    OrganizationsApiModule,
    ContributionsModule,
    DiscordModule,
    ProblemsApiModule,
  ],
  controllers: [
    BlogPostsController,
    BlogDraftsController,
    OrganizationPostsController,
    BlogEditingController,
    BlogVotesController,
    BlogModerationController,
  ],
  providers: [
    BlogPostsService,
    BlogEditingService,
    BlogDraftsService,
    BlogVotesService,
    BlogModerationService,
    RateLimitService,
  ],
  exports: [BlogPostsService],
})
export class BlogApiModule {}
