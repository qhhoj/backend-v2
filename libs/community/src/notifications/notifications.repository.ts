import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isDuplicateKey } from '@libs/common';
import { Notification, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';
import { notificationExpiry } from './notification-draft';
import type { NotificationDraft } from './notification-draft';

const MERGE_ATTEMPTS = 3;

/** What a merge overwrites. A merge never lowers the priority. */
function mergedFields(draft: NotificationDraft): Partial<Notification> {
  return {
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    path: draft.path,
    ...(draft.priority === 'high' ? { priority: 'high' as const } : {}),
  };
}

/** Time only moves forward: a late writer holding an older `now` cannot move the row back. */
const mergedTimes = (now: Date) => ({
  lastActivityAt: now,
  expiresAt: notificationExpiry(now),
});

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  /** Merges into the user's unread row of the group, else inserts one; an insert that loses on the unique partial index (a concurrent writer) retries from the merge, up to `MERGE_ATTEMPTS`, so a row read in between gets a fresh unread row. Returns the row id. */
  async merge(
    userId: string,
    draft: NotificationDraft,
    now: Date,
  ): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const merged = await this.mergeIntoUnread(userId, draft, now);
      if (merged) return merged;
      try {
        return await this.insert(userId, draft, now);
      } catch (error) {
        if (!isDuplicateKey(error) || attempt >= MERGE_ATTEMPTS) throw error;
      }
    }
  }

  /** Marks the users' unread rows of one group read (an assignee removed from a ticket). */
  async markGroupRead(
    userIds: readonly string[],
    groupKey: string,
    now: Date,
  ): Promise<number> {
    const { modifiedCount } = await this.notifications
      .updateMany(
        { user: { $in: [...userIds] }, groupKey, unread: true },
        { $set: { unread: false, readAt: now } },
      )
      .exec();
    return modifiedCount;
  }

  /** The filter names `unread: true`, which is what the partial unique index serves. */
  private async mergeIntoUnread(
    userId: string,
    draft: NotificationDraft,
    now: Date,
  ): Promise<string | null> {
    const row = await this.notifications
      .findOneAndUpdate(
        { user: userId, groupKey: draft.groupKey, unread: true },
        {
          $inc: { count: 1 },
          $set: mergedFields(draft),
          $max: mergedTimes(now),
        },
        { projection: { _id: 1 } },
      )
      .lean()
      .exec();
    return row ? uuidStr(row._id) : null;
  }

  private async insert(
    userId: string,
    draft: NotificationDraft,
    now: Date,
  ): Promise<string> {
    const created = await this.notifications.create({
      user: userId,
      ...draft,
      count: 1,
      unread: true,
      readAt: null,
      lastRef: null,
      lastActivityAt: now,
      createdAt: now,
      expiresAt: notificationExpiry(now),
    });
    return uuidStr(created._id);
  }
}
