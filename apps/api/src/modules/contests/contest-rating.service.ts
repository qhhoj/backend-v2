import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import {
  CONTEST_RATING_QUEUE,
  contestPhase,
  enqueueContestRating,
} from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { ContestsService } from './contests.service';
import type { QueuedResponse } from './dto/queued.response';

@Injectable()
export class ContestRatingService {
  constructor(
    private readonly contestsService: ContestsService,
    @InjectQueue(CONTEST_RATING_QUEUE)
    private readonly ratings: Queue<ContestRatingJob>,
  ) {}

  /** Legacy admin `rate_view`: any ended contest; one that is no longer rated loses its ratings, and the later contests are re-rated. */
  async rate(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<QueuedResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    if (!hasPermission(principal, 'judge.contest_rating'))
      throw new AppError('forbidden', 403, 'Rating needs judge.contest_rating');
    if (contestPhase(contest, now) !== 'ended')
      throw new AppError('conflict', 409, 'The contest has not ended');
    await enqueueContestRating(this.ratings, contest._id);
    return { queued: true };
  }
}
