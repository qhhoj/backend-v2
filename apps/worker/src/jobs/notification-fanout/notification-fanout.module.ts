import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATION_FANOUT_QUEUE } from '@libs/community';
import { NotificationFanoutProcessor } from './notification-fanout.processor';
import { NotificationFanoutRepository } from './notification-fanout.repository';
import { NotificationFanoutService } from './notification-fanout.service';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_FANOUT_QUEUE })],
  providers: [
    NotificationFanoutProcessor,
    NotificationFanoutService,
    NotificationFanoutRepository,
  ],
})
export class NotificationFanoutModule {}
