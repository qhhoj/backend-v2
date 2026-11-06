import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectJob, REDIS } from '@libs/common';
import type { JobProducer } from '@libs/common';
import { communityJobs, notifyContributionPoints } from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { ProblemEvents } from '../problems/core/problem.events';

/** Queues the worker's recompute of contribution points; never throws (the change is committed). */
@Injectable()
export class ContributionPointsService implements OnModuleInit {
  constructor(
    @InjectJob(communityJobs.contributionPoints)
    private readonly jobs: JobProducer<ContributionPointsJob>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly problemEvents: ProblemEvents,
  ) {}

  /** A suggested problem turning public (or private) moves its suggester's 20 points. */
  onModuleInit(): void {
    this.problemEvents.on('publicityChanged', (_problemId, suggester) => {
      if (suggester) void this.refresh([suggester]);
    });
  }

  refresh(userIds: readonly string[]): Promise<void> {
    return notifyContributionPoints(this.jobs, this.redis, userIds);
  }
}
