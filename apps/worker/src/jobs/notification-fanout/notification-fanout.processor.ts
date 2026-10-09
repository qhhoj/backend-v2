import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NOTIFICATION_FANOUT_QUEUE } from '@libs/community';
import type { NotificationFanoutJob } from '@libs/community';
import { NotificationFanoutService } from './notification-fanout.service';

@Processor(NOTIFICATION_FANOUT_QUEUE, { concurrency: 2 })
export class NotificationFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationFanoutProcessor.name);

  constructor(private readonly fanout: NotificationFanoutService) {
    super();
  }

  process(job: Job<NotificationFanoutJob>): Promise<number> {
    return this.fanout.announce(job.data.announcementId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationFanoutJob> | undefined, error: Error): void {
    this.logger.error(
      `Notification fan-out of announcement ${job?.data.announcementId} failed: ${error.message}`,
    );
  }
}
