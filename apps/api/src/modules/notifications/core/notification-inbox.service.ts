import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError, Paginated, RateLimitService } from '@libs/common';
import { NOTIFICATIONS_PAGE_SIZE } from '@libs/community';
import type { NotificationListQueryDto } from './dto/notification-list.dto';
import {
  NotificationResponse,
  UnreadCountResponse,
} from './dto/notification.response';
import { NotificationInboxRepository } from './notification-inbox.repository';
import { READ_ALL_LIMIT, READ_ALL_WINDOW_SECONDS } from './rate-limits';

/** A superuser acting as another user must not clear that user's unread state. */
const isImpersonating = (auth: AuthContext): boolean =>
  Boolean(auth.session?.impersonatorId);

@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly inbox: NotificationInboxRepository,
    private readonly rateLimits: RateLimitService,
  ) {}

  async list(
    userId: string,
    query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    const { rows, total } = await this.inbox.page(userId, query);
    return new Paginated(
      rows.map((row) => NotificationResponse.from(row)),
      { page: query.page, pageSize: NOTIFICATIONS_PAGE_SIZE, total },
    );
  }

  async unreadCount(userId: string): Promise<UnreadCountResponse> {
    return { count: await this.inbox.countUnread(userId) };
  }

  /** Idempotent. Under impersonation a 204 no-op, without even looking the row up. */
  async markRead(auth: AuthContext, id: string): Promise<void> {
    if (isImpersonating(auth)) return;
    const result = await this.inbox.markRead(
      auth.principal.userId,
      id,
      new Date(),
    );
    if (result === 'missing')
      throw new AppError('not_found', 404, 'No such notification');
  }

  async markAllRead(auth: AuthContext): Promise<void> {
    if (isImpersonating(auth)) return;
    const { userId } = auth.principal;
    await this.rateLimits.reserve(
      [`notification-read-all:${userId}`],
      READ_ALL_LIMIT,
      READ_ALL_WINDOW_SECONDS,
    );
    await this.inbox.markAllRead(userId, new Date());
  }
}
