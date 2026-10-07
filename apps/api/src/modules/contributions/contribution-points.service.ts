import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import {
  CONTRIBUTION_POINTS_QUEUE,
  notifyContributionPoints,
} from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { ProblemEvents } from '../problems/core/problem.events';

/** Queues the worker's recompute of contribution points; never throws (the change is committed). */
@Injectable()
export class ContributionPointsService implements OnModuleInit {
  private readonly logger = new Logger(ContributionPointsService.name);

  constructor(
    @InjectQueue(CONTRIBUTION_POINTS_QUEUE)
    private readonly queue: Queue<ContributionPointsJob>,
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
    return notifyContributionPoints(
      this.queue,
      this.redis,
      userIds,
      this.logger,
    );
  }
}
