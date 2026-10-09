import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { ProblemsApiModule } from '../../problems/problems-api.module';
import { ContestAccessModule } from '../core/contest-access.module';

/** Ranking replay (read side). */
@Module({
  imports: [
    ContestAccessModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: CONTEST_REPLAY_QUEUE }),
  ],
})
export class ReplayModule {}
