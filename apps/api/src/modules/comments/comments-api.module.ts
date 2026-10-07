import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { BlogAccessModule } from '../blog/core/blog-access.module';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { TagsApiModule } from '../tags/tags-api.module';
import { CommentLocksRepository } from './core/comment-locks.repository';
import { CommentPagesService } from './core/comment-pages.service';
import { CommentsController } from './core/comments.controller';
import { CommentsRepository } from './core/comments.repository';
import { CommentsService } from './core/comments.service';

@Module({
  imports: [
    AuthModule,
    BlogAccessModule,
    ContestAccessModule,
    ProblemsApiModule,
    TagsApiModule,
    ContributionsModule,
  ],
  controllers: [CommentsController],
  providers: [
    CommentsRepository,
    CommentLocksRepository,
    CommentPagesService,
    CommentsService,
  ],
  exports: [CommentsRepository, CommentPagesService, CommentsService],
})
export class CommentsApiModule {}
