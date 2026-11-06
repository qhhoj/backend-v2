import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { OrganizationPointsService } from './organization-points.service';

@Injectable()
export class OrganizationPointsProcessor extends JobProcessor<
  OrganizationPointsJob,
  void
>(communityJobs.organizationPoints) {
  constructor(private readonly points: OrganizationPointsService) {
    super();
  }

  run({ organizationId }: OrganizationPointsJob): Promise<void> {
    return this.points.recompute(organizationId);
  }
}
