import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ShortLinkRedirectController } from './short-link-redirect.controller';
import { ShortLinksController } from './short-links.controller';
import { ShortLinksRepository } from './short-links.repository';
import { ShortLinksService } from './short-links.service';
import { randomShortCode, SHORT_CODE_SOURCE } from './short-code';

@Module({
  imports: [AuthModule],
  controllers: [ShortLinksController, ShortLinkRedirectController],
  providers: [
    ShortLinksRepository,
    ShortLinksService,
    RateLimitService,
    { provide: SHORT_CODE_SOURCE, useValue: { next: () => randomShortCode() } },
  ],
})
export class ShortLinksModule {}
