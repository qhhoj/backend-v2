import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { JOB_RETENTION, JOB_RETRY, withinTimeout } from '@libs/judging';
import { COMMUNITY_ENQUEUE_TIMEOUT_MS } from '../queues';

export const NOTIFICATION_FANOUT_QUEUE = 'notification-fanout';
export const NOTIFICATION_FANOUT_JOB = 'announcement';
/** Rows written per `bulkWrite` by the fan-out job. */
export const NOTIFICATION_FANOUT_CHUNK = 500;
/** Write one inbox row per recipient of a contest announcement. Enqueued when an announcement is pushed (created or resent) in a contest with `pushAnnouncements`; the job reads everything else from Mongo. */
export interface NotificationFanoutJob {
  announcementId: string;
}

export const NOTIFICATION_TRIM_QUEUE = 'notification-trim';
export const NOTIFICATION_TRIM_JOB = 'trim';
export const NOTIFICATION_TRIM_SCHEDULER = 'notification-trim-nightly';
/** 03:30 every night (a pattern scheduler queues no job at boot). */
export const NOTIFICATION_TRIM_PATTERN = '30 3 * * *';

/** Fire-and-forget like `notifyDiscord`: the announcement is saved; a lost fan-out is logged and a resend repeats it. Never rethrown. */
export async function notifyAnnouncementFanout(
  queue: Queue<NotificationFanoutJob>,
  announcementId: string,
  logger: Logger,
): Promise<void> {
  try {
    await withinTimeout(
      queue.add(
        NOTIFICATION_FANOUT_JOB,
        { announcementId },
        { ...JOB_RETRY, ...JOB_RETENTION },
      ),
      COMMUNITY_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Notification fan-out of announcement ${announcementId} not enqueued: ${(error as Error).message}`,
    );
  }
}
