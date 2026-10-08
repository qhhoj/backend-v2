import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { TICKET_EVENTS_CHANNEL } from '@libs/community';
import type { TicketEvent } from '@libs/community';
import { publishEvent } from '@libs/judging';

/** The one place that publishes ticket events; best effort, never throws (Mongo holds the state). */
@Injectable()
export class TicketEventsService {
  private readonly logger = new Logger(TicketEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  publish(event: TicketEvent): Promise<void> {
    return publishEvent(
      this.redis,
      {
        channel: TICKET_EVENTS_CHANNEL,
        payload: event,
        label: `Ticket ${event.ticketId} ${event.type}`,
      },
      this.logger,
    );
  }
}
