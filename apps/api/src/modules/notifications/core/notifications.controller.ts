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
@Controller('api/internal/notifications')
export class NotificationsController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @ApiPaginatedResponse(NotificationResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    return this.inbox.list(auth.principal.userId, query);
  }

  /** The bell polls this every 60 s and on window focus. */
  @Header('Cache-Control', 'private, max-age=15')
  @Get('unread-count')
  unreadCount(@CurrentAuth() auth: AuthContext): Promise<UnreadCountResponse> {
    return this.inbox.unreadCount(auth.principal.userId);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.inbox.markAllRead(auth);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: NotificationIdParamDto,
  ): Promise<void> {
    return this.inbox.markRead(auth, id);
  }
}
