import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '@libs/auth';
import { ApiTextResponse, ENV, RawResponse } from '@libs/common';
import type { Env } from '@libs/common';
import { PreviewService } from './preview.service';
import { robotsTxt } from './robots';
import { SitemapService } from './sitemap.service';
import { PreviewQueryDto, SitemapParamsDto } from './dto/seo-params.dto';

/** nginx maps `/robots.txt`, `/sitemap.xml`, `/sitemap-<kind>-<page>.xml` and link-preview bots' page requests here. */
@Public()
@RawResponse()
@ApiTags('Home & site')
@Controller('api/internal/seo')
export class SeoController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly sitemaps: SitemapService,
    private readonly previews: PreviewService,
  ) {}

  /**
   * Read robots.txt
   *
   * @remarks
   * Public. Allows the public pages, disallows the admin area, the API and account pages, and points to the sitemap.
   */
  @ApiTextResponse('text/plain')
  @Get('robots.txt')
  robots(@Res({ passthrough: true }) reply: FastifyReply): string {
    reply.type('text/plain; charset=utf-8');
    return robotsTxt(this.env.siteUrl);
  }

  /**
   * Read the sitemap index
   *
   * @remarks
   * Public. Lists one sitemap per part of the site (static pages, problems, contests, posts, users) and per 10000 URLs. Only what a signed-out visitor may read is listed; cached for an hour.
   */
  @ApiTextResponse('application/xml')
  @Get('sitemap.xml')
  async sitemapIndex(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const xml = await this.sitemaps.index();
    reply.type('application/xml; charset=utf-8');
    return xml;
  }

  /**
   * Read one sitemap
   *
   * @remarks
   * Public. Returns the URLs of page `page` of `kind`. 404 `not_found` past the last page.
   */
  @ApiTextResponse('application/xml')
  @Get('sitemaps/:kind/:page')
  async sitemap(
    @Param() { kind, page }: SitemapParamsDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const xml = await this.sitemaps.page(kind, page);
    reply.type('application/xml; charset=utf-8');
    return xml;
  }

  /**
   * Read the link-preview tags of a page
   *
   * @remarks
   * Public. Returns a small HTML document with `og:` and `twitter:` tags for a problem, contest, blog post or user page, for link-preview bots that do not run the SPA. A page that does not exist or is not public gets the site's generic tags.
   */
  @ApiTextResponse('text/html')
  @Get('preview')
  async preview(
    @Query() { path }: PreviewQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const html = await this.previews.render(path);
    reply.type('text/html; charset=utf-8');
    return html;
  }
}
