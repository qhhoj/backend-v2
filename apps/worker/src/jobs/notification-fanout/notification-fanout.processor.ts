import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import type { NotificationFanoutJob } from '@libs/community';
import { NotificationFanoutService } from './notification-fanout.service';

@Injectable()
export class NotificationFanoutProcessor extends JobProcessor<
  NotificationFanoutJob,
  number
>(communityJobs.notificationFanout) {
  constructor(private readonly fanout: NotificationFanoutService) {
    super();
  }

  run({ announcementId }: NotificationFanoutJob): Promise<number> {
    return this.fanout.announce(announcementId);
  }
}
