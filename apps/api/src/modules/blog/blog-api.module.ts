import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ContributionsModule } from '../contributions/contributions.module';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { BlogAccessModule } from './core/blog-access.module';
import { BlogPostsController } from './core/blog-posts.controller';
import { BlogPostsService } from './core/blog-posts.service';
import { OrganizationPostsController } from './core/organization-posts.controller';

@Module({
  imports: [
    AuthModule,
    BlogAccessModule,
    OrganizationsApiModule,
    ContributionsModule,
  ],
  controllers: [BlogPostsController, OrganizationPostsController],
  providers: [BlogPostsService],
  exports: [BlogPostsService],
})
export class BlogApiModule {}
