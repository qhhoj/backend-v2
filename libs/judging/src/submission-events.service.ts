import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { SUBMISSION_EVENTS_CHANNEL } from './submission-events';
import type { SubmissionEvent } from './submission-events';
import { withinTimeout } from './within-timeout';

/** Longest a packet or request waits for an event to reach Redis. */
export const EVENT_PUBLISH_TIMEOUT_MS = 1000;

@Injectable()
export class SubmissionEventsService implements OnModuleInit {
  private readonly logger = new Logger(SubmissionEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** One awaited command is the readiness wait: ioredis queues it until the connection is up, so boot-time events (the bridge's `queued` announcements) are not skipped by the `ready` guard below. */
  async onModuleInit(): Promise<void> {
    await this.redis.ping();
  }

  /** Fire-and-forget like bridge commands; skipped at once while the client is not ready, so an outage costs nothing: Mongo holds the state, and a page that missed an event gets the current state when its stream reconnects. */
  async publish(event: SubmissionEvent): Promise<void> {
    if (this.redis.status !== 'ready') {
      this.logger.warn(
        `Event ${event.type} of submission ${event.submissionId} skipped: Redis is ${this.redis.status}`,
      );
      return;
    }
    try {
      await withinTimeout(
        this.redis.publish(SUBMISSION_EVENTS_CHANNEL, JSON.stringify(event)),
        EVENT_PUBLISH_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.error(
        `Event ${event.type} of submission ${event.submissionId} not published: ${(error as Error).message}`,
      );
    }
  }
}
