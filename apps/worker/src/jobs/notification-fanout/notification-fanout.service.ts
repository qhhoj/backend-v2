import { Injectable } from '@nestjs/common';
import {
  contestAnnouncementDraft,
  fitDraft,
  NOTIFICATION_FANOUT_CHUNK,
} from '@libs/community';
import { uuidStr } from '@libs/database';
import { receivesAnnouncement } from './announcement-recipients';
import { NotificationFanoutRepository } from './notification-fanout.repository';
import type { AnnouncedContest } from './notification-fanout.repository';

@Injectable()
export class NotificationFanoutService {
  constructor(private readonly fanout: NotificationFanoutRepository) {}

  /** Idempotent: a retry, or a read between two runs, merges nothing twice (`refs`). A resend reuses the announcement id, so it notifies only users the first run did not reach. An announcement or contest deleted since is skipped. Returns the number of recipients. */
  async announce(announcementId: string, now = new Date()): Promise<number> {
    const announcement = await this.fanout.announcement(announcementId);
    const contest =
      announcement &&
      (await this.fanout.contest(uuidStr(announcement.contest)));
    if (!announcement || !contest) return 0;
    const draft = fitDraft(
      contestAnnouncementDraft({
        contestId: uuidStr(contest._id),
        contestKey: contest.key,
        contestName: contest.name,
        announcementTitle: announcement.title,
      }),
    );
    let recipients = 0;
    for await (const userIds of this.recipientChunks(contest, now)) {
      const done = await this.fanout.appliedUsers(userIds, announcementId);
      const pending = userIds.filter((userId) => !done.has(userId));
      if (pending.length)
        await this.fanout.upsertRows(pending, draft, {
          ref: announcementId,
          at: announcement.createdAt,
          now,
        });
      recipients += userIds.length;
    }
    return recipients;
  }

  /** Each user once, in chunks of `NOTIFICATION_FANOUT_CHUNK`. */
  private async *recipientChunks(
    contest: AnnouncedContest,
    now: Date,
  ): AsyncGenerator<string[]> {
    const seen = new Set<string>();
    let chunk: string[] = [];
    for await (const row of this.fanout.participationsOf(
      uuidStr(contest._id),
    )) {
      const userId = uuidStr(row.user);
      if (seen.has(userId) || !receivesAnnouncement(contest, row, now))
        continue;
      seen.add(userId);
      chunk.push(userId);
      if (chunk.length === NOTIFICATION_FANOUT_CHUNK) {
        yield chunk;
        chunk = [];
      }
    }
    if (chunk.length) yield chunk;
  }
}
