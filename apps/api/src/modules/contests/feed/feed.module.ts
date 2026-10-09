import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { EventsModule } from '../../events/events.module';
import { ContestAccessModule } from '../core/contest-access.module';
import { FeedAuthService } from './feed-auth.service';
import { FeedController } from './feed.controller';
import { FeedDataRepository } from './feed-data.repository';
import { DEFAULT_FEED_LIMITS, FEED_LIMITS, FeedService } from './feed.service';
import { FeedStreamController } from './feed-stream.controller';
import {
  DEFAULT_FEED_STREAM_OPTIONS,
  FEED_STREAM_OPTIONS,
  FeedStreamService,
} from './feed-stream.service';
import { FeedKeysController } from './feed-keys.controller';
import { FeedKeysRepository } from './feed-keys.repository';
import { FeedKeysService } from './feed-keys.service';

/** The ICPC event feed and its keys. */
@Module({
  imports: [AuthModule, ContestAccessModule, EventsModule],
  controllers: [FeedKeysController, FeedController, FeedStreamController],
  providers: [
    FeedKeysService,
    FeedKeysRepository,
    FeedAuthService,
    RateLimitService,
    FeedService,
    FeedDataRepository,
    FeedStreamService,
    {
      provide: FEED_STREAM_OPTIONS,
      useValue: DEFAULT_FEED_STREAM_OPTIONS,
    },
    { provide: FEED_LIMITS, useValue: DEFAULT_FEED_LIMITS },
  ],
  exports: [FeedAuthService, FeedKeysRepository, FeedService],
})
export class FeedModule {}
