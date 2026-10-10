import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { ApiFileResponse, RawResponse } from '@libs/common';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { FeedAuthService } from './feed-auth.service';
import { FeedService } from './feed.service';

@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/feed')
export class FeedController {
  constructor(
    private readonly auth: FeedAuthService,
    private readonly feeds: FeedService,
  ) {}

  /**
   * Get the event feed of a contest
   *
   * @remarks
   * For ICPC resolver tools. Authenticated with HTTP Basic, user `feed` and a
   * contest feed key as password, no session. Returns the whole feed as
   * NDJSON, one event per line. A key in `frozen-until-release` mode shows the
   * feed cut at the freeze until an editor releases it. All failures are the
   * same 401 `unauthorized` and wrong attempts are rate limited per IP (429
   * `rate_limited`); 409 `feed_too_large` when the contest has too many
   * submissions.
   */
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
