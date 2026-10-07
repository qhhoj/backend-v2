import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { LeaderboardsRepository } from './leaderboards/leaderboards.repository';
import { UserPagesController } from './pages/user-pages.controller';
import { UserPagesRepository } from './pages/user-pages.repository';
import { UserPagesService } from './pages/user-pages.service';

@Module({
  imports: [AuthModule, OrganizationsApiModule, ProblemsApiModule],
  controllers: [UserPagesController],
  providers: [LeaderboardsRepository, UserPagesRepository, UserPagesService],
})
export class UsersApiModule {}
