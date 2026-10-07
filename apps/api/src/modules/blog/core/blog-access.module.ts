import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { OrganizationsApiModule } from '../../organizations/organizations-api.module';
import { BlogPostsRepository } from './blog-posts.repository';
import { BlogVisibilityService } from './blog-visibility.service';

/** Post reads the comments module needs (blog pages): depends on neither blog nor comments, so it never closes a module cycle. */
@Module({
  imports: [AuthModule, OrganizationsApiModule],
  providers: [BlogPostsRepository, BlogVisibilityService],
  exports: [BlogPostsRepository, BlogVisibilityService],
})
export class BlogAccessModule {}
