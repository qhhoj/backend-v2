import { Module } from '@nestjs/common';
import { PreviewService } from './preview.service';
import { SeoController } from './seo.controller';
import { SeoRepository } from './seo.repository';
import { SitemapService } from './sitemap.service';

/** robots.txt, sitemaps and link-preview tags; nothing imports it. */
@Module({
  controllers: [SeoController],
  providers: [SeoRepository, SitemapService, PreviewService],
})
export class SeoApiModule {}
