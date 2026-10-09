import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ContestAccessModule } from '../core/contest-access.module';
import { FeedAuthService } from './feed-auth.service';
import { FeedKeysController } from './feed-keys.controller';
import { FeedKeysRepository } from './feed-keys.repository';
import { FeedKeysService } from './feed-keys.service';

/** The ICPC event feed and its keys. */
@Module({
  imports: [AuthModule, ContestAccessModule],
  controllers: [FeedKeysController],
  providers: [
    FeedKeysService,
    FeedKeysRepository,
    FeedAuthService,
    RateLimitService,
  ],
  exports: [FeedAuthService, FeedKeysRepository],
})
export class FeedModule {}
