import { Module } from '@nestjs/common';
import { ActiveUsersStore } from './capture/active-users.store';
import { ActivityWriterRepository } from './capture/activity-writer.repository';
import { UserActivityCaptureService } from './capture/user-activity-capture.service';

@Module({
  providers: [
    ActivityWriterRepository,
    ActiveUsersStore,
    UserActivityCaptureService,
  ],
  exports: [ActiveUsersStore],
})
export class UserActivityModule {}
