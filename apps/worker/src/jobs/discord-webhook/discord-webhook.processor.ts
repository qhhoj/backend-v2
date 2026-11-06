import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import type { DiscordWebhookJob } from '@libs/community';
import { DiscordWebhookService } from './discord-webhook.service';

@Injectable()
export class DiscordWebhookProcessor extends JobProcessor<
  DiscordWebhookJob,
  void
>(communityJobs.discordWebhook) {
  constructor(private readonly webhooks: DiscordWebhookService) {
    super();
  }

  async run(job: DiscordWebhookJob): Promise<void> {
    await this.webhooks.send(job);
  }
}
