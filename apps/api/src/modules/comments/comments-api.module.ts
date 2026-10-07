import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { BlogAccessModule } from '../blog/core/blog-access.module';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { DiscordModule } from '../discord/discord.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { TagsApiModule } from '../tags/tags-api.module';
import { CommentLocksRepository } from './core/comment-locks.repository';
import { CommentPagesService } from './core/comment-pages.service';
import { CommentsController } from './core/comments.controller';
import { CommentsRepository } from './core/comments.repository';
import { CommentsService } from './core/comments.service';
import { CommentPostingController } from './posting/comment-posting.controller';
import { CommentPostingService } from './posting/comment-posting.service';

@Module({
  imports: [
    AuthModule,
    BlogAccessModule,
    ContestAccessModule,
    ProblemsApiModule,
    TagsApiModule,
    ContributionsModule,
    DiscordModule,
  ],
  controllers: [CommentsController, CommentPostingController],
  providers: [
    CommentsRepository,
    CommentLocksRepository,
    CommentPagesService,
    CommentsService,
    CommentPostingService,
    RateLimitService,
  ],
  exports: [CommentsRepository, CommentPagesService, CommentsService],
})
export class CommentsApiModule {}
