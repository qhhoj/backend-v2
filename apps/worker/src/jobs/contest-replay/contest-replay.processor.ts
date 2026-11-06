import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestReplayJob } from '@libs/contests';
import { ContestReplayService } from './contest-replay.service';

@Injectable()
export class ContestReplayProcessor extends JobProcessor<
  ContestReplayJob,
  { events: number }
>(contestJobs.replay) {
  constructor(private readonly replays: ContestReplayService) {
    super();
  }

  run({ contestId }: ContestReplayJob) {
    return this.replays.build(contestId);
  }
}
