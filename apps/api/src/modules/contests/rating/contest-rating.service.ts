import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, InjectJob } from '@libs/common';
import type { JobProducer } from '@libs/common';
import { contestJobs, contestPhase, isFrozen } from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { ContestsService } from '../core/contests.service';
import type { QueuedResponse } from '../core/dto/queued.response';

@Injectable()
export class ContestRatingService {
  constructor(
    private readonly contestsService: ContestsService,
    @InjectJob(contestJobs.rating)
    private readonly ratings: JobProducer<ContestRatingJob>,
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
    if (isFrozen(contest, now))
      throw new AppError('conflict', 409, 'Unfreeze the ranking before rating');
    await this.ratings.add({ contestId: contest._id });
    return { queued: true };
  }
}
