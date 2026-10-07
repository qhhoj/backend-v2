import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  notifyOrganizationPoints,
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import type { Queue } from 'bullmq';

/** Queues the worker's recompute of PP and member count after a membership change; never throws (the change is committed). */
@Injectable()
export class OrganizationPointsService {
  private readonly logger = new Logger(OrganizationPointsService.name);

  constructor(
    @InjectQueue(ORGANIZATION_POINTS_QUEUE)
    private readonly queue: Queue<OrganizationPointsJob>,
  ) {}

  refresh(organizationIds: readonly string[]): Promise<void> {
    return notifyOrganizationPoints(
      this.queue,
      [...new Set(organizationIds)],
      this.logger,
    );
  }
}
