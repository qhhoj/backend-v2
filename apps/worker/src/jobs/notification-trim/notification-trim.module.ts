import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { NotificationTrimProcessor } from './notification-trim.processor';
import { NotificationTrimRepository } from './notification-trim.repository';
import { NotificationTrimService } from './notification-trim.service';

@Module({
  imports: [JobsModule.register(communityJobs.notificationTrim)],
  providers: [
    NotificationTrimProcessor,
    NotificationTrimService,
    NotificationTrimRepository,
  ],
})
export class NotificationTrimModule {}
