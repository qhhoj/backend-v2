import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { ApiNdjsonStream } from '@libs/common';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { FeedLineResponse } from './dto/feed-frame.response';
import { FeedStreamService } from './feed-stream.service';

/** Under the events prefix: nginx serves it unbuffered with a long read timeout (decisions.md). */
@ApiTags('Live events')
@Controller('api/internal/events/contests')
export class FeedStreamController {
  constructor(private readonly streams: FeedStreamService) {}

  /**
   * Stream the event feed of a contest
   *
   * @remarks
   * The feed as `application/x-ndjson`: the snapshot first, then new events as
   * one JSON line each, re-checked every 10 seconds. Authenticated with HTTP
   * Basic like the snapshot. A blank line is sent every 30 seconds as keep-
   * alive, and the stream ends when the key stops qualifying or builds keep
   * failing; reconnect to continue. At most two streams per key (429
   * `rate_limited`); 409 `feed_too_large_for_stream` for contests that are too
   * large, poll the snapshot instead.
   */
  @Public()
  @ApiNdjsonStream(FeedLineResponse)
  @Get(':key/feed')
  async feed(
    @Param() { key }: ContestKeyParamDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.streams.open(request, reply, key);
  }
}
