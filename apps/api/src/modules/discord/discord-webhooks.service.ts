import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { SettingsService } from '@libs/settings';
import {
  DISCORD_WEBHOOK_QUEUE,
  discordWebhookUrl,
  notifyDiscord,
} from '@libs/community';
import type {
  DiscordEvent,
  DiscordMessage,
  DiscordWebhookJob,
} from '@libs/community';

/** The only api door to Discord: skips events without a URL, so an empty `discord.webhooks` setting queues nothing. */
@Injectable()
export class DiscordWebhooksService {
  private readonly logger = new Logger(DiscordWebhooksService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
    @InjectQueue(DISCORD_WEBHOOK_QUEUE)
    private readonly queue: Queue<DiscordWebhookJob>,
  ) {}

  async notify(event: DiscordEvent, message: DiscordMessage): Promise<void> {
    if (discordWebhookUrl(this.settings.get('discord.webhooks'), event))
      await notifyDiscord(this.queue, { event, message }, this.logger);
  }

  /** Legacy `SITE_FULL_URL + path`. */
  link(path: string): string {
    return `${this.env.siteUrl}${path}`;
  }

  author(username: string): { name: string; url: string } {
    return {
      name: username,
      url: this.link(`/user/${encodeURIComponent(username)}`),
    };
  }
}
