import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { ActiveUsersStore } from './capture/active-users.store';
import { ActivityWriterRepository } from './capture/activity-writer.repository';
import { UserActivityCaptureService } from './capture/user-activity-capture.service';
import { ActivityExportService } from './staff/activity-export.service';
import { ActivityLiveService } from './staff/activity-live.service';
import { ActivityLogsRepository } from './staff/activity-logs.repository';
import { ActivityLogsService } from './staff/activity-logs.service';
import { ActivitySummaryRepository } from './staff/activity-summary.repository';
import { ActivitySummaryService } from './staff/activity-summary.service';
import { UserActivityStaffController } from './staff/user-activity-staff.controller';

@Module({
  imports: [AuthModule, ProblemsApiModule],
  controllers: [UserActivityStaffController],
  providers: [
    ActivityWriterRepository,
    ActiveUsersStore,
    UserActivityCaptureService,
    ActivityLogsRepository,
    ActivityLogsService,
    ActivitySummaryRepository,
    ActivitySummaryService,
    ActivityExportService,
    ActivityLiveService,
  ],
  exports: [ActiveUsersStore],
})
export class UserActivityModule {}
