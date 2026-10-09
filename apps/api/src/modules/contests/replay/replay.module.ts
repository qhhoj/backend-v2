import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RateLimitService } from '@libs/common';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { ProblemsApiModule } from '../../problems/problems-api.module';
import { ContestAccessModule } from '../core/contest-access.module';
import { RankingUsersRepository } from '../ranking/ranking-users.repository';
import { ReplayController } from './replay.controller';
import { ReplayService } from './replay.service';
import { ReplaysRepository } from './replays.repository';

/** Ranking replay (read side): serves the stored build; the worker writes it. */
@Module({
  imports: [
    ContestAccessModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: CONTEST_REPLAY_QUEUE }),
  ],
  controllers: [ReplayController],
  providers: [
    ReplayService,
    ReplaysRepository,
    RankingUsersRepository,
    RateLimitService,
  ],
})
export class ReplayModule {}
