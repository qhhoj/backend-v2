import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { JOB_RETENTION, withinTimeout } from '@libs/judging';
import type { DiscordEvent, DiscordMessage } from './discord';

export const COMMUNITY_ENQUEUE_TIMEOUT_MS = 1000;
/** First retry delay of the queue's jobs; BullMQ doubles it per attempt. */
const RETRY_BACKOFF_MS = 10_000;

export const ORGANIZATION_POINTS_QUEUE = 'organization-points';
export const ORGANIZATION_POINTS_JOB = 'recompute';
/** Recompute an organization's performance points and member count. Enqueued by membership changes (api) and by the user-points effect when a member's PP changed (worker). */
export interface OrganizationPointsJob {
  organizationId: string;
}

/** Safety expiry of a pending flag whose job was lost. */
const POINTS_PENDING_SECONDS = 60;
const pendingKey = (organizationId: string) =>
  `organization-points:pending:${organizationId}`;

/** The worker clears the flag when a recompute starts, so a change arriving during one flags and queues the next. */
export const clearOrganizationPointsPending = (
  redis: Redis,
  organizationId: string,
) => redis.del(pendingKey(organizationId));

interface FlaggedJob<Data> {
  pendingKey: (id: string) => string;
  jobName: string;
  dataOf: (id: string) => Data;
  /** Log prefix, e.g. `Points of organizations`. */
  label: string;
}

/** At most one waiting job per id: a Redis flag set here and cleared when the job starts (a `jobId` would also drop adds during a running recompute, leaving it stale). Duplicate ids collapse too. Never rethrown: the write that caused it is committed; a lost recompute waits for the next change (logged). */
async function enqueueFlagged<Data>(
  // Untyped: BullMQ's `addBulk` job-name typing rejects `Queue<Data>` with a plain string name.
  queue: Queue,
  redis: Redis,
  ids: readonly string[],
  job: FlaggedJob<Data>,
  logger: Logger,
): Promise<void> {
  const flagged: string[] = [];
  try {
    await withinTimeout(
      (async () => {
        for (const id of new Set(ids))
          if (
            (await redis.set(
              job.pendingKey(id),
              '1',
              'EX',
              POINTS_PENDING_SECONDS,
              'NX',
            )) === 'OK'
          )
            flagged.push(id);
        if (!flagged.length) return;
        await queue.addBulk(
          flagged.map((id) => ({
            name: job.jobName,
            data: job.dataOf(id),
            opts: {
              attempts: 3,
              backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
              ...JOB_RETENTION,
            },
          })),
        );
      })(),
      COMMUNITY_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    await Promise.allSettled(
      flagged.map((id) => redis.del(job.pendingKey(id))),
    );
    logger.error(
      `${job.label} ${ids.join(', ')} not enqueued: ${(error as Error).message}`,
    );
  }
}

export const notifyOrganizationPoints = (
  queue: Queue<OrganizationPointsJob>,
  redis: Redis,
  organizationIds: readonly string[],
  logger: Logger,
): Promise<void> =>
  enqueueFlagged(
    queue,
    redis,
    organizationIds,
    {
      pendingKey,
      jobName: ORGANIZATION_POINTS_JOB,
      dataOf: (organizationId) => ({ organizationId }),
      label: 'Points of organizations',
    },
    logger,
  );

export const CONTRIBUTION_POINTS_QUEUE = 'contribution-points';
export const CONTRIBUTION_POINTS_JOB = 'recompute';
/** Recompute a user's contribution points. Enqueued by votes, hide/unhide, post visibility, authors and deletion, and a suggested problem's publicity. */
export interface ContributionPointsJob {
  userId: string;
}

const contributionPendingKey = (userId: string) =>
  `contribution-points:pending:${userId}`;

/** The worker clears the flag when a recompute starts, like the organization flag. */
export const clearContributionPointsPending = (redis: Redis, userId: string) =>
  redis.del(contributionPendingKey(userId));

export const notifyContributionPoints = (
  queue: Queue<ContributionPointsJob>,
  redis: Redis,
  userIds: readonly string[],
  logger: Logger,
): Promise<void> =>
  enqueueFlagged(
    queue,
    redis,
    userIds,
    {
      pendingKey: contributionPendingKey,
      jobName: CONTRIBUTION_POINTS_JOB,
      dataOf: (userId) => ({ userId }),
      label: 'Contribution points of users',
    },
    logger,
  );

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

export const DISCORD_WEBHOOK_QUEUE = 'discord-webhook';
export const DISCORD_WEBHOOK_JOB = 'send';
/** The worker resolves the URL from its own env: the webhook URL (a secret) never enters job data or logs. */
export interface DiscordWebhookJob {
  event: DiscordEvent;
  message: DiscordMessage;
}

/** Fire-and-forget like the other community enqueues: a Redis outage loses the message (logged), never the write that caused it. */
export async function notifyDiscord(
  queue: Queue<DiscordWebhookJob>,
  job: DiscordWebhookJob,
  logger: Logger,
): Promise<void> {
  try {
    await withinTimeout(
      queue.add(DISCORD_WEBHOOK_JOB, job, {
        attempts: 3,
        backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
        ...JOB_RETENTION,
      }),
      COMMUNITY_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Discord ${job.event} not enqueued: ${(error as Error).message}`,
    );
  }
}
