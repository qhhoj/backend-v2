import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ContestReplayProcessor } from './contest-replay.processor';
import { ContestReplayRepository } from './contest-replay.repository';
import { ContestReplayService } from './contest-replay.service';

/** Builds chunked contest replays from the live participations' submissions and the stored ghosts. */
@Module({
  imports: [
    SubmissionEffectsModule,
    BullModule.registerQueue({ name: CONTEST_REPLAY_QUEUE }),
  ],
  providers: [
    ContestReplayProcessor,
    ContestReplayService,
    ContestReplayRepository,
  ],
})
export class ContestReplayModule {}
