import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ContestReplayProcessor } from './contest-replay.processor';
import { ContestReplayRepository } from './contest-replay.repository';
import { ContestReplayService } from './contest-replay.service';

/** Builds chunked contest replays from the live participations' submissions and the stored ghosts. */
@Module({
  imports: [SubmissionEffectsModule, JobsModule.register(contestJobs.replay)],
  providers: [
    ContestReplayProcessor,
    ContestReplayService,
    ContestReplayRepository,
  ],
})
export class ContestReplayModule {}
