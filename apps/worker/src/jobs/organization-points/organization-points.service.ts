import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, runCoalesced } from '@libs/common';
import {
  clearOrganizationPointsPending,
  ORGANIZATION_PP_ENTRIES,
  organizationPoints,
} from '@libs/community';
import { OrganizationPointsRepository } from './organization-points.repository';

/** Legacy `Organization.on_user_changes`: the only writer of an organization's `performancePoints` and `memberCount`. Reads Mongo and `$set`s, serialised per organization across processes; bursts collapse. */
@Injectable()
export class OrganizationPointsService {
  constructor(
    private readonly repository: OrganizationPointsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Clears the pending flag first: a change from now on queues a job that runs after this one. */
  async recompute(organizationId: string): Promise<void> {
    await clearOrganizationPointsPending(this.redis, organizationId);
    await runCoalesced(
      this.redis,
      `effects:organization:${organizationId}`,
      async () => {
        const [points, memberCount] = await Promise.all([
          this.repository.topMemberPoints(
            organizationId,
            ORGANIZATION_PP_ENTRIES,
          ),
          this.repository.countMembers(organizationId),
        ]);
        await this.repository.setPoints(organizationId, {
          performancePoints: organizationPoints(points),
          memberCount,
        });
      },
    );
  }
}
