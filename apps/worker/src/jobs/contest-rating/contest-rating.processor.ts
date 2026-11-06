import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { ContestRatingService } from './contest-rating.service';

@Injectable()
export class ContestRatingProcessor extends JobProcessor<
  ContestRatingJob,
  { contests: number; ratings: number }
>(contestJobs.rating) {
  constructor(private readonly ratings: ContestRatingService) {
    super();
  }

  run({ contestId }: ContestRatingJob) {
    return this.ratings.rateFrom(contestId);
  }
}
