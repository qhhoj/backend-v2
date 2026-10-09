import { Module } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/** For api and worker modules that write inbox rows; `REDIS` comes from the app's global `RedisModule`, the model from `DatabaseModule`. */
@Module({
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
