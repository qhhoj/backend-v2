import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { NotificationFanoutProcessor } from './notification-fanout.processor';
import { NotificationFanoutRepository } from './notification-fanout.repository';
import { NotificationFanoutService } from './notification-fanout.service';

@Module({
  imports: [JobsModule.register(communityJobs.notificationFanout)],
  providers: [
    NotificationFanoutProcessor,
    NotificationFanoutService,
    NotificationFanoutRepository,
  ],
})
export class NotificationFanoutModule {}
