import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_CAP_PER_USER } from '@libs/community';
import { NotificationTrimRepository } from './notification-trim.repository';

/** A user cannot pass the cap without new activity, so only users active in the last 25 hours (one hour of slack) are visited. */
const ACTIVITY_WINDOW_MS = 25 * 3_600_000;
const DELETE_BATCH = 1000;

@Injectable()
export class NotificationTrimService {
  private readonly logger = new Logger(NotificationTrimService.name);

  constructor(private readonly rows: NotificationTrimRepository) {}

  /** Keeps each user's newest `NOTIFICATION_CAP_PER_USER` rows by `lastActivityAt`. Safe to repeat. */
  async trim(now = new Date()): Promise<{ users: number; deleted: number }> {
    const since = new Date(now.getTime() - ACTIVITY_WINDOW_MS);
    let users = 0;
    let deleted = 0;
    for (const userId of await this.rows.activeSince(since)) {
      const removed = await this.trimUser(userId);
      if (removed) {
        users += 1;
        deleted += removed;
      }
    }
    if (deleted)
      this.logger.log(`Inbox trim: ${deleted} rows of ${users} users removed`);
    return { users, deleted };
  }

  private async trimUser(userId: string): Promise<number> {
    if ((await this.rows.count(userId)) <= NOTIFICATION_CAP_PER_USER) return 0;
    let removed = 0;
    for (;;) {
      const candidates = await this.rows.beyondNewest(
        userId,
        NOTIFICATION_CAP_PER_USER,
        DELETE_BATCH,
      );
      if (!candidates.length) return removed;
      const deleted = await this.rows.deleteUnchanged(candidates);
      // Every candidate was merged into since it was read: the next night sees them again.
      if (!deleted) return removed;
      removed += deleted;
    }
  }
}
