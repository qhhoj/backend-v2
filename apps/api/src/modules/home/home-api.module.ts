import { Module } from '@nestjs/common';
import { BlogAccessModule } from '../blog/core/blog-access.module';
import { CommentsApiModule } from '../comments/comments-api.module';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { UsersApiModule } from '../users/users-api.module';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { HomeController } from './home.controller';
import { HomeRepository } from './home.repository';
import { HomeService } from './home.service';

/** Homepage data and RSS/Atom feeds; nothing imports it. */
@Module({
  imports: [
    BlogAccessModule,
    CommentsApiModule,
    OrganizationsApiModule,
    UsersApiModule,
    ProblemsApiModule,
  ],
  controllers: [HomeController, FeedsController],
  providers: [HomeRepository, HomeService, FeedsService],
})
export class HomeApiModule {}
