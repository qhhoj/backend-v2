import { ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  NotificationIdParamDto,
  NotificationListQueryDto,
} from './dto/notification-list.dto';
import {
  NotificationResponse,
  UnreadCountResponse,
} from './dto/notification.response';
import { NotificationInboxService } from './notification-inbox.service';

/** The signed-in user's inbox. Realtime nudges come from `GET /events/user`. */
@ApiTags('Notifications')
@Controller('api/internal/notifications')
export class NotificationsController {
  constructor(private readonly inbox: NotificationInboxService) {}

  /**
   * List my notifications
   *
   * @remarks
   * Signed-in callers only. Returns the caller's inbox, most recently active first, 20 per page. Filter by `state` (`all`, `unread`, `read`), `priority` and repeated `kind` parameters. Repeated events can be merged into one row whose `count` grows.
   */
  @ApiPaginatedResponse(NotificationResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    return this.inbox.list(auth.principal.userId, query);
  }

  /**
   * Count my unread notifications
   *
   * @remarks
   * Signed-in callers only. Returns the number of unread notifications. The client may reuse the answer for 15 seconds (`private, max-age=15`); the bell polls every 60 seconds and on window focus.
   */
  @Header('Cache-Control', 'private, max-age=15')
  @Get('unread-count')
  unreadCount(@CurrentAuth() auth: AuthContext): Promise<UnreadCountResponse> {
    return this.inbox.unreadCount(auth.principal.userId);
  }

  /**
   * Mark all notifications as read
   *
   * @remarks
   * Signed-in callers only. Marks the whole inbox read. Limited to 30 calls per user per minute (429 `rate_limited`). While a superuser impersonates, it does nothing. Returns 204.
   */
  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.inbox.markAllRead(auth);
  }

  /**
   * Mark a notification as read
   *
   * @remarks
   * Signed-in callers only. Idempotent. 404 `not_found` for an unknown id or one that belongs to another user. While a superuser impersonates, it does nothing. Returns 204.
   */
  @Post(':id/read')
  @HttpCode(204)
  read(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: NotificationIdParamDto,
  ): Promise<void> {
    return this.inbox.markRead(auth, id);
  }
}
