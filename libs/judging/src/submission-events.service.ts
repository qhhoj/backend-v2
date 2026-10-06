import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { SUBMISSION_EVENTS_CHANNEL } from './submission-events';
import type { SubmissionEvent } from './submission-events';
import { withinTimeout } from './within-timeout';

/** Longest a packet or request waits for an event to reach Redis. */
export const EVENT_PUBLISH_TIMEOUT_MS = 1000;

@Injectable()
export class SubmissionEventsService {
  private readonly logger = new Logger(SubmissionEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Fire-and-forget like bridge commands: Mongo holds the state, and a page that missed an event gets the current state when its stream reconnects. */
  async publish(event: SubmissionEvent): Promise<void> {
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
