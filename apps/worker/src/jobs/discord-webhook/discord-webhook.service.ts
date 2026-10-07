import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { discordPayload, discordWebhookUrl } from '@libs/community';
import type { DiscordWebhookJob } from '@libs/community';

/** A hung webhook must not hold a worker slot. */
const DISCORD_TIMEOUT_MS = 10_000;

/** Legacy `send_webhook`, with the URL read from this process's env. */
@Injectable()
export class DiscordWebhookService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** False when no URL is configured for the event (removed since the enqueue); a non-2xx answer throws so the job retries. */
  async send(job: DiscordWebhookJob): Promise<boolean> {
    const url = discordWebhookUrl(this.env.discordWebhookUrls, job.event);
    if (!url) return false;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(discordPayload(job.message)),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(`Discord answered ${response.status} to ${job.event}`);
    return true;
  }
}
