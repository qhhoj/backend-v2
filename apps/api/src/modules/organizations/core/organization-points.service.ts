import { Inject, Injectable } from '@nestjs/common';
import { communityJobs, notifyOrganizationPoints } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { InjectJob, REDIS } from '@libs/common';
import type { JobProducer } from '@libs/common';
import type Redis from 'ioredis';

/** Queues the worker's recompute of PP and member count after a membership change; never throws (the change is committed). */
@Injectable()
export class OrganizationPointsService {
  constructor(
    @InjectJob(communityJobs.organizationPoints)
    private readonly jobs: JobProducer<OrganizationPointsJob>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  refresh(organizationIds: readonly string[]): Promise<void> {
    return notifyOrganizationPoints(this.jobs, this.redis, organizationIds);
  }
}
