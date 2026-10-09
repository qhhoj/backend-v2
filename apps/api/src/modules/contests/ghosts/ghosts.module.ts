import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { ProblemsApiModule } from '../../problems/problems-api.module';
import { ContestAccessModule } from '../core/contest-access.module';
import { GhostsRepository } from './ghosts.repository';

/** Ghost participations of a contest (staff-imported historical standings). A changed set queues a replay build, hence the queue. */
@Module({
  imports: [
    ContestAccessModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: CONTEST_REPLAY_QUEUE }),
  ],
  providers: [GhostsRepository],
  exports: [GhostsRepository],
})
export class GhostsModule {}
