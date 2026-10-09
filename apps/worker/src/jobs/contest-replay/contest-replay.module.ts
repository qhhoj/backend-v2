import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';

/** Builds contest replays (see `ContestReplayService`, added with the job). */
@Module({
  imports: [
    SubmissionEffectsModule,
    BullModule.registerQueue({ name: CONTEST_REPLAY_QUEUE }),
  ],
})
export class ContestReplayModule {}
