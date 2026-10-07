import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { FeedParamsDto } from './dto/feed-params.dto';
import { FeedsService } from './feeds.service';

/** nginx maps the legacy `/feed/<kind>/<rss|atom>/` URLs here. */
@Public()
@Controller('api/internal/feeds')
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @RawResponse()
  @Get(':kind/:format')
  async feed(
    @Param() { kind, format }: FeedParamsDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const xml = await this.feeds.feed(kind, format);
    reply.type(
      format === 'rss'
        ? 'application/rss+xml; charset=utf-8'
        : 'application/atom+xml; charset=utf-8',
    );
    return xml;
  }
}
