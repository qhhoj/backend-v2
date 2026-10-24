import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, runCoalesced } from '@libs/common';
import {
  clearContributionPointsPending,
  contributionPoints,
} from '@libs/community';
import { ContributionPointsRepository } from './contribution-points.repository';

/** Legacy `calculate_contribution_points`: the only writer of `users.contributionPoints`. Reads Mongo and `$set`s, serialised per user across processes; bursts of votes collapse. */
@Injectable()
export class ContributionPointsService {
  constructor(
    private readonly repository: ContributionPointsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async recompute(userId: string): Promise<void> {
    await clearContributionPointsPending(this.redis, userId);
    await runCoalesced(this.redis, `effects:contribution:${userId}`, async () =>
      this.repository.setPoints(
        userId,
        contributionPoints(await this.repository.totals(userId)),
      ),
    );
  }
}
