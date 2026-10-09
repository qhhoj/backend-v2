import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isUuid, Notification } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';
import { NOTIFICATIONS_PAGE_SIZE } from '@libs/community';
import type { NotificationListQueryDto } from './dto/notification-list.dto';

export type MarkReadResult = 'marked' | 'already' | 'missing';

const filterOf = (
  userId: string,
  { state, priority, kind }: NotificationListQueryDto,
): FilterQuery<Notification> => ({
  user: userId,
  ...(state === 'all' ? {} : { unread: state === 'unread' }),
  ...(priority ? { priority } : {}),
  // No index leads with `kind`: the `{user, ...}` index narrows to the user's at most 500 rows first.
  ...(kind?.length ? { kind: { $in: kind } } : {}),
});

/** The read side of the inbox; the write side is `NotificationsService` in `@libs/community`. */
@Injectable()
export class NotificationInboxRepository {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  /** Newest activity first, through `{user, lastActivityAt, _id}` or `{user, unread, lastActivityAt, _id}`. */
  async page(
    userId: string,
    query: NotificationListQueryDto,
  ): Promise<{ rows: Notification[]; total: number }> {
    const filter = filterOf(userId, query);
    const [rows, total] = await Promise.all([
      this.notifications
        .find(filter)
        .sort({ lastActivityAt: -1, _id: -1 })
        .skip((query.page - 1) * NOTIFICATIONS_PAGE_SIZE)
        .limit(NOTIFICATIONS_PAGE_SIZE)
        .lean<Notification[]>()
        .exec(),
      this.notifications.countDocuments(filter).exec(),
    ]);
    return { rows, total };
  }

  countUnread(userId: string): Promise<number> {
    return this.notifications
      .countDocuments({ user: userId, unread: true })
      .exec();
  }

  /** `already` = the row is the caller's and was read before; `missing` = not the caller's, unknown or malformed. */
  async markRead(
    userId: string,
    id: string,
    now: Date,
  ): Promise<MarkReadResult> {
    if (!isUuid(id)) return 'missing';
    const { matchedCount } = await this.notifications
      .updateOne(
        { _id: id, user: userId, unread: true },
        { $set: { unread: false, readAt: now } },
      )
      .exec();
    if (matchedCount) return 'marked';
    const own = await this.notifications.exists({ _id: id, user: userId });
    return own ? 'already' : 'missing';
  }

  async markAllRead(userId: string, now: Date): Promise<void> {
    await this.notifications
      .updateMany(
        { user: userId, unread: true },
        { $set: { unread: false, readAt: now } },
      )
      .exec();
  }
}
