import { Module } from '@nestjs/common';
import { RateLimitService } from '@libs/common';
import { ProblemsApiModule } from '../../problems/problems-api.module';
import { ContestAccessModule } from '../core/contest-access.module';
import { RankingUsersRepository } from '../ranking/ranking-users.repository';
import { BalloonsController } from './balloons.controller';
import { BalloonsRepository } from './balloons.repository';
import { BalloonsService } from './balloons.service';

/** The on-site balloon queue. */
@Module({
  imports: [ContestAccessModule, ProblemsApiModule],
  controllers: [BalloonsController],
  providers: [
    BalloonsService,
    BalloonsRepository,
    RankingUsersRepository,
    RateLimitService,
  ],
})
export class BalloonsModule {}
