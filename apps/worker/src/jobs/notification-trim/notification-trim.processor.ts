import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import { NotificationTrimService } from './notification-trim.service';

@Injectable()
export class NotificationTrimProcessor extends JobProcessor<
  void,
  { users: number; deleted: number }
>(communityJobs.notificationTrim) {
  constructor(private readonly trims: NotificationTrimService) {
    super();
  }

  run() {
    return this.trims.trim();
  }
}
