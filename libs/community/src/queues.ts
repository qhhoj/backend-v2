import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { JOB_RETENTION, withinTimeout } from '@libs/judging';

export const COMMUNITY_ENQUEUE_TIMEOUT_MS = 1000;

export const ORGANIZATION_POINTS_QUEUE = 'organization-points';
export const ORGANIZATION_POINTS_JOB = 'recompute';
/** Recompute an organization's performance points and member count. Enqueued by membership changes (api) and by the user-points effect when a member's PP changed (worker). */
export interface OrganizationPointsJob {
  organizationId: string;
}

/** No `jobId` (an add during a running recompute must not be dropped); the worker coalesces bursts per organization with `runCoalesced`. Never rethrown: the membership write is committed; a lost recompute waits for the next change (logged). */
export async function notifyOrganizationPoints(
  queue: Queue<OrganizationPointsJob>,
  organizationIds: readonly string[],
  logger: Logger,
): Promise<void> {
  if (!organizationIds.length) return;
  try {
    await withinTimeout(
      queue.addBulk(
        organizationIds.map((organizationId) => ({
          name: ORGANIZATION_POINTS_JOB,
          data: { organizationId },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
            ...JOB_RETENTION,
          },
        })),
      ),
      COMMUNITY_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Points of organizations ${organizationIds.join(', ')} not enqueued: ${(error as Error).message}`,
    );
  }
}

export const USER_DATA_QUEUE = 'user-data';
export const USER_DATA_JOB = 'prepare';
export const USER_DATA_SWEEP_JOB = 'sweep';
export const USER_DATA_SWEEP_SCHEDULER = 'user-data-sweep-hourly';
export const USER_DATA_SWEEP_MS = 3_600_000;
/** Zip the user's own data into `USER_DATA_ROOT/<userId>.zip`. */
export interface UserDataJob {
  userId: string;
}

export const userDataJobId = (userId: string) => `user-data-${userId}`;
/** At most one job per user, dropped as soon as it ends either way: "preparing" is "the job exists", and a failure never blocks the next request. */
export const oneJobPerUser = (userId: string) => ({
  jobId: userDataJobId(userId),
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
});
