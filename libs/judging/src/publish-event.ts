import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { withinTimeout } from './within-timeout';

/** Longest a packet or request waits for an event to reach Redis. */
export const EVENT_PUBLISH_TIMEOUT_MS = 1000;

/** Fire-and-forget: skipped at once while the client is not ready, bounded by `EVENT_PUBLISH_TIMEOUT_MS`; a failure is logged, never thrown (Mongo holds the state; streams resync on reconnect). */
export async function publishEvent(
  redis: Redis,
  event: { channel: string; payload: unknown; label: string },
  logger: Logger,
): Promise<void> {
  const { channel, payload, label } = event;
  if (redis.status !== 'ready')
    return void logger.warn(`${label} skipped: Redis is ${redis.status}`);
  try {
    await withinTimeout(
      redis.publish(channel, JSON.stringify(payload)),
      EVENT_PUBLISH_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(`${label} not published: ${(error as Error).message}`);
  }
}
