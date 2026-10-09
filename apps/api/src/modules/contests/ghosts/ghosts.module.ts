import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { ProblemsApiModule } from '../../problems/problems-api.module';
import { ContestAccessModule } from '../core/contest-access.module';
import { GhostsController } from './ghosts.controller';
import { GhostsRepository } from './ghosts.repository';
import { GhostsService } from './ghosts.service';

/** Ghost participations of a contest (staff-imported historical standings). A changed set queues a replay build, hence the queue. */
@Module({
  imports: [
    ContestAccessModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: CONTEST_REPLAY_QUEUE }),
  ],
  controllers: [GhostsController],
  providers: [GhostsRepository, GhostsService],
  exports: [GhostsRepository],
})
export class GhostsModule {}
