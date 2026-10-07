import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
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
      redirect: 'error',
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    }).catch((error: Error) => {
      // undici messages can carry the URL (a secret): keep only the error class
      throw new Error(`Discord ${job.event} unreachable: ${error.name}`);
    });
    if (!response.ok) {
      const message = `Discord answered ${response.status} to ${job.event}`;
      // a refused payload or a dead webhook will not improve on retry; 429 will
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw new UnrecoverableError(message);
      throw new Error(message);
    }
    return true;
  }
}
