import { Injectable } from '@nestjs/common';
import { AppError, invalidField } from '@libs/common';
import { discordWebhookUrl } from '@libs/community';
import type { DiscordEvent } from '@libs/community';
import { SettingError, SettingsService } from '@libs/settings';
import { DiscordWebhooksService } from '@libs/community';
import { WEBHOOK_SLOTS } from './dto/discord-webhook.dto';
import type {
  DiscordWebhookResponse,
  WebhookSlot,
} from './dto/discord-webhook.dto';

const KEY = 'discord.webhooks';
const SHOWN_TAIL = 4;

/** Enough to tell two URLs apart without revealing the token: the host and the last characters. */
export const maskWebhook = (url: string): string => {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  return `${host}/…${url.slice(-SHOWN_TAIL)}`;
};

/** The `discord.webhooks` setting one slot at a time: the whole value stays secret, each slot shows a masked target, and every change is a setting revision. */
@Injectable()
export class DiscordWebhooksAdminService {
  constructor(
    private readonly settings: SettingsService,
    private readonly discord: DiscordWebhooksService,
  ) {}

  list(): DiscordWebhookResponse[] {
    const urls = this.settings.get(KEY);
    return WEBHOOK_SLOTS.map((event) => {
      const own = urls[event];
      return {
        event,
        target: own ? maskWebhook(own) : null,
        usesDefault: event !== 'default' && !own && Boolean(urls.default),
      };
    });
  }

  set(
    event: WebhookSlot,
    url: string,
    actorId: string,
  ): Promise<DiscordWebhookResponse[]> {
    return this.write({ [event]: url }, actorId);
  }

  async remove(
    event: WebhookSlot,
    actorId: string,
  ): Promise<DiscordWebhookResponse[]> {
    if (this.settings.get(KEY)[event] === undefined) return this.list();
    return this.write({ [event]: null }, actorId);
  }

  /** The setting merges the patch inside its write transaction, so two admins editing different events never drop each other's URL. */
  private async write(
    patch: Record<string, string | null>,
    actorId: string,
  ): Promise<DiscordWebhookResponse[]> {
    try {
      await this.settings.set(KEY, patch, actorId);
    } catch (error) {
      if (error instanceof SettingError)
        throw invalidField('url', error.message);
      throw error;
    }
    return this.list();
  }

  /** Queues a test embed through the same path as real events; 409 `webhook_unset` when the event would not be sent. */
  async test(event: DiscordEvent, username: string): Promise<void> {
    if (!discordWebhookUrl(this.settings.get(KEY), event))
      throw new AppError(
        'webhook_unset',
        409,
        'Neither this event nor default has a URL',
      );
    await this.discord.notify(event, {
      title: 'Test message',
      description: `A test of ${event}, sent from the admin settings.`,
      author: this.discord.author(username),
    });
  }
}
