import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DISCORD_WEBHOOK_QUEUE } from '@libs/community';
import type { DiscordWebhookJob } from '@libs/community';
import { DiscordWebhookService } from './discord-webhook.service';

@Processor(DISCORD_WEBHOOK_QUEUE, { concurrency: 2 })
export class DiscordWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscordWebhookProcessor.name);

  constructor(private readonly webhooks: DiscordWebhookService) {
    super();
  }

  async process(job: Job<DiscordWebhookJob>): Promise<void> {
    await this.webhooks.send(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DiscordWebhookJob> | undefined, error: Error): void {
    this.logger.error(`Discord ${job?.data.event} failed: ${error.message}`);
  }
}
