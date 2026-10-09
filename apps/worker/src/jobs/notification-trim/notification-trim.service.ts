import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_CAP_PER_USER } from '@libs/community';
import { NotificationTrimRepository } from './notification-trim.repository';

const DELETE_BATCH = 1000;

@Injectable()
export class NotificationTrimService {
  private readonly logger = new Logger(NotificationTrimService.name);

  constructor(private readonly rows: NotificationTrimRepository) {}

  /** Keeps each user's newest `NOTIFICATION_CAP_PER_USER` rows by `lastActivityAt`. Visits the users over the cap (found by count, not by recent activity), so a skipped night or a failed run leaves nobody behind. Safe to repeat. */
  async trim(): Promise<{ users: number; deleted: number }> {
    let users = 0;
    let deleted = 0;
    for (const userId of await this.rows.overCap(NOTIFICATION_CAP_PER_USER)) {
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
