import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, unique } from '@libs/common';
import { publishEvent } from '@libs/judging';
import { fitDraft, NOTIFY_RECIPIENT_LIMIT } from './notification-draft';
import type { NotificationDraft } from './notification-draft';
import { NOTIFICATION_EVENTS_CHANNEL } from './notification-events';
import type { NotificationEvent } from './notification-events';
import { NotificationsRepository } from './notifications.repository';

/** The one way to put a row in an inbox. Producers call it after their own write committed; nothing here ever throws, so a notification problem never fails the request that caused it. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notifications: NotificationsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Writes (or merges) the draft for each distinct recipient, at most `NOTIFY_RECIPIENT_LIMIT`, and nudges their open streams. The caller removes the actor from `recipients`. */
  async notify(
    recipients: readonly string[],
    draft: NotificationDraft,
    now = new Date(),
  ): Promise<void> {
    try {
      const fitted = fitDraft(draft);
      const targets = unique([...recipients]);
      if (targets.length > NOTIFY_RECIPIENT_LIMIT)
        this.logger.warn(
          `Notification ${draft.groupKey}: ${targets.length} recipients, writing ${NOTIFY_RECIPIENT_LIMIT}`,
        );
      await Promise.all(
        targets
          .slice(0, NOTIFY_RECIPIENT_LIMIT)
          .map((userId) => this.deliver(userId, fitted, now)),
      );
    } catch (error) {
      this.logger.error(
        `Notification ${draft.groupKey} not written: ${(error as Error).message}`,
      );
    }
  }

  /** The users' unread rows of one group are read now (they lost access to the thing the group points at). */
  async dismiss(
    userIds: readonly string[],
    groupKey: string,
    now = new Date(),
  ): Promise<void> {
    if (!userIds.length) return;
    try {
      await this.notifications.markGroupRead(userIds, groupKey, now);
    } catch (error) {
      this.logger.error(
        `Dismissing ${groupKey} failed: ${(error as Error).message}`,
      );
    }
  }

  private async deliver(
    userId: string,
    draft: NotificationDraft,
    now: Date,
  ): Promise<void> {
    try {
      const id = await this.notifications.merge(userId, draft, now);
      const payload: NotificationEvent = { userId, id };
      await publishEvent(
        this.redis,
        {
          channel: NOTIFICATION_EVENTS_CHANNEL,
          payload,
          label: `Notification ${id} of user ${userId}`,
        },
        this.logger,
      );
    } catch (error) {
      this.logger.error(
        `Notification ${draft.groupKey} for user ${userId} not written: ${(error as Error).message}`,
      );
    }
  }
}
