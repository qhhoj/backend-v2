import type Redis from 'ioredis';
import {
  defineJob,
  HOUR_MS,
  JOB_RETENTION,
  JOB_RETRY,
  ONE_SHOT_JOB,
  SCHEDULED_RETENTION,
} from '@libs/common';
import type { JobContract, JobProducer } from '@libs/common';
import type { DiscordEvent, DiscordMessage } from './discord';

/** Recompute an organization's performance points and member count. Enqueued by membership changes (api) and by the user-points effect when a member's PP changed (worker). */
export interface OrganizationPointsJob {
  organizationId: string;
}

/** Recompute a user's contribution points. Enqueued by votes, hide/unhide, post visibility, authors and deletion, and a suggested problem's publicity. */
export interface ContributionPointsJob {
  userId: string;
}

/** Zip the user's own data into `USER_DATA_ROOT/<userId>.zip`. */
export interface UserDataJob {
  userId: string;
}

/** Only the event and the message travel: the webhook URL (a secret) never enters job data or logs. The worker resolves it from the `discord.webhooks` setting when it sends; the enqueue's check of the same setting only saves a job for an event without a URL. */
export interface DiscordWebhookJob {
  event: DiscordEvent;
  message: DiscordMessage;
}

/** Write one inbox row per recipient of a contest announcement. Enqueued when an announcement is pushed (created or resent) in a contest with `pushAnnouncements`; the job reads everything else from Mongo. */
export interface NotificationFanoutJob {
  announcementId: string;
}
/** Rows written per `bulkWrite` by the fan-out job. */
export const NOTIFICATION_FANOUT_CHUNK = 500;

export const userDataJobId = (userId: string): string => `user-data-${userId}`;

/** The community and identity jobs (identity has no lib of its own yet). */
export const communityJobs = {
  organizationPoints: defineJob<OrganizationPointsJob>({
    queue: 'organization-points',
    name: 'recompute',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ organizationId }) =>
      `Points of organization ${organizationId}`,
    concurrency: 4,
  }),
  contributionPoints: defineJob<ContributionPointsJob>({
    queue: 'contribution-points',
    name: 'recompute',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ userId }) => `Contribution points of user ${userId}`,
    concurrency: 4,
  }),
  /** One zip at a time per worker process (memory and disk); the hourly sweep shares the queue. */
  userData: defineJob<UserDataJob>({
    queue: 'user-data',
    name: 'prepare',
    options: ONE_SHOT_JOB,
    jobId: ({ userId }) => userDataJobId(userId),
    describe: ({ userId }) => `User data of ${userId}`,
  }),
  userDataSweep: defineJob<void>({
    queue: 'user-data',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'User data sweep',
    schedule: { id: 'user-data-sweep-hourly', every: HOUR_MS },
  }),
  /** A Redis outage loses the message (logged), never the write that caused it. */
  discordWebhook: defineJob<DiscordWebhookJob>({
    queue: 'discord-webhook',
    name: 'send',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ event }) => `Discord ${event}`,
    concurrency: 2,
  }),
  /** A lost fan-out is logged; a resend of the announcement repeats it. */
  notificationFanout: defineJob<NotificationFanoutJob>({
    queue: 'notification-fanout',
    name: 'announcement',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ announcementId }) =>
      `Notification fan-out of announcement ${announcementId}`,
    concurrency: 2,
  }),
  /** Retried: the trim is idempotent. */
  notificationTrim: defineJob<void>({
    queue: 'notification-trim',
    name: 'trim',
    options: { ...JOB_RETRY, ...SCHEDULED_RETENTION },
    describe: () => 'Inbox trim',
    schedule: {
      id: 'notification-trim-nightly',
      pattern: '30 3 * * *',
      tz: 'site',
    },
  }),
  organizationUsageAudit: defineJob<void>({
    queue: 'organization-usage-audit',
    name: 'audit',
    options: { removeOnComplete: true, removeOnFail: 20 },
    describe: () => 'Usage audit',
    schedule: {
      id: 'organization-usage-audit-nightly',
      pattern: '0 3 * * *',
      tz: 'site',
    },
  }),
};

/** Safety expiry of a pending flag whose job was lost. */
const PENDING_SECONDS = 60;
const pendingKey = (contract: JobContract<never>, id: string) =>
  `${contract.queue}:pending:${id}`;

/** A recompute keyed by one id, at most one waiting per id. */
interface FlaggedJob<Payload> {
  jobs: JobProducer<Payload>;
  payloadOf: (id: string) => Payload;
  /** Log subject, e.g. `Points of organizations`. */
  label: string;
}

/** At most one waiting job per id: a Redis flag set here and cleared when the job starts (a `jobId` would also drop adds during a running recompute, leaving it stale). Duplicate ids collapse too. Best effort: the write that caused it is committed; a lost recompute waits for the next change (logged), and a failed add clears its flags. */
async function enqueueFlagged<Payload>(
  redis: Redis,
  ids: readonly string[],
  { jobs, payloadOf, label }: FlaggedJob<Payload>,
): Promise<void> {
  const flagged: string[] = [];
  const isQueued = await jobs.bestEffort(
    `${label} ${ids.join(', ')} not enqueued`,
    async () => {
      for (const id of new Set(ids))
        if (
          (await redis.set(
            pendingKey(jobs.contract, id),
            '1',
            'EX',
            PENDING_SECONDS,
            'NX',
          )) === 'OK'
        )
          flagged.push(id);
      if (flagged.length) await jobs.addBulk(flagged.map(payloadOf));
    },
  );
  if (!isQueued)
    await Promise.allSettled(
      flagged.map((id) => redis.del(pendingKey(jobs.contract, id))),
    );
}

export const notifyOrganizationPoints = (
  jobs: JobProducer<OrganizationPointsJob>,
  redis: Redis,
  organizationIds: readonly string[],
): Promise<void> =>
  enqueueFlagged(redis, organizationIds, {
    jobs,
    payloadOf: (organizationId) => ({ organizationId }),
    label: 'Points of organizations',
  });

export const notifyContributionPoints = (
  jobs: JobProducer<ContributionPointsJob>,
  redis: Redis,
  userIds: readonly string[],
): Promise<void> =>
  enqueueFlagged(redis, userIds, {
    jobs,
    payloadOf: (userId) => ({ userId }),
    label: 'Contribution points of users',
  });

/** The worker clears the flag when a recompute starts, so a change arriving during one flags and queues the next. */
export const clearOrganizationPointsPending = (
  redis: Redis,
  organizationId: string,
) => redis.del(pendingKey(communityJobs.organizationPoints, organizationId));

export const clearContributionPointsPending = (redis: Redis, userId: string) =>
  redis.del(pendingKey(communityJobs.contributionPoints, userId));
