import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { SUBMISSION_EVENTS_CHANNEL } from './submission-events';
import type { SubmissionEvent } from './submission-events';
import { publishEvent } from './publish-event';

export { EVENT_PUBLISH_TIMEOUT_MS } from './publish-event';

@Injectable()
export class SubmissionEventsService implements OnModuleInit {
  private readonly logger = new Logger(SubmissionEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** One awaited command is the readiness wait: ioredis queues it until the connection is up, so boot-time events (the bridge's `queued` announcements) are not skipped by the `ready` guard below. */
  async onModuleInit(): Promise<void> {
    await this.redis.ping();
  }

  /** Fire-and-forget like bridge commands: an outage costs nothing, Mongo holds the state and a page that missed an event gets the current state when its stream reconnects. */
  publish(event: SubmissionEvent): Promise<void> {
    return publishEvent(
      this.redis,
      {
        channel: SUBMISSION_EVENTS_CHANNEL,
        payload: event,
        label: `Event ${event.type} of submission ${event.submissionId}`,
      },
      this.logger,
    );
  }
}
