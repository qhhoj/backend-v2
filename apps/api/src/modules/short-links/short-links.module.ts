import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ShortLinkRedirectController } from './short-link-redirect.controller';
import { ShortLinksController } from './short-links.controller';
import { ShortLinksRepository } from './short-links.repository';
import { ShortLinksService } from './short-links.service';

@Module({
  imports: [AuthModule],
  controllers: [ShortLinksController, ShortLinkRedirectController],
  providers: [ShortLinksRepository, ShortLinksService, RateLimitService],
})
export class ShortLinksModule {}
