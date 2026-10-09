import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATION_TRIM_QUEUE } from '@libs/community';
import { NotificationTrimProcessor } from './notification-trim.processor';
import { NotificationTrimRepository } from './notification-trim.repository';
import { NotificationTrimService } from './notification-trim.service';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_TRIM_QUEUE })],
  providers: [
    NotificationTrimProcessor,
    NotificationTrimService,
    NotificationTrimRepository,
  ],
})
export class NotificationTrimModule {}
