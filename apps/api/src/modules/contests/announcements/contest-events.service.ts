import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { CONTEST_EVENTS_CHANNEL } from '@libs/contests';
import type { ContestEvent } from '@libs/contests';
import { publishEvent } from '@libs/judging';

@Injectable()
export class ContestEventsService {
  private readonly logger = new Logger(ContestEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  publish(event: ContestEvent): Promise<void> {
    return publishEvent(
      this.redis,
      {
        channel: CONTEST_EVENTS_CHANNEL,
        payload: event,
        label: `Announcement ${event.announcementId} of contest ${event.contestId}`,
      },
      this.logger,
    );
  }
}
