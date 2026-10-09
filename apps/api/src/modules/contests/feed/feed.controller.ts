import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { ApiFileResponse, RawResponse } from '@libs/common';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { FeedAuthService } from './feed-auth.service';
import { FeedService } from './feed.service';

@Controller('api/internal/contests/:key/feed')
export class FeedController {
  constructor(
    private readonly auth: FeedAuthService,
    private readonly feeds: FeedService,
  ) {}

  /** HTTP Basic with the contest's feed key, no session: resolver tools only speak Basic. NDJSON, one event per line. */
  @Public()
  @ApiFileResponse('application/x-ndjson')
  @RawResponse()
  @Get()
  async snapshot(
    @Param() { key }: ContestKeyParamDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const context = await this.auth.authorize(
      { authorization: request.headers.authorization, ip: request.ip },
      key,
    );
    const events = await this.feeds.eventsFor(context);
    reply
      .type('application/x-ndjson; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    return this.feeds.ndjson(events);
  }
}
