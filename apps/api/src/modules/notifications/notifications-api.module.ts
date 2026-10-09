import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { NotificationsModule } from '@libs/community';
import { NotificationInboxRepository } from './core/notification-inbox.repository';
import { NotificationInboxService } from './core/notification-inbox.service';
import { NotificationsController } from './core/notifications.controller';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationInboxRepository,
    NotificationInboxService,
    RateLimitService,
  ],
  exports: [NotificationsModule],
})
export class NotificationsApiModule {}
