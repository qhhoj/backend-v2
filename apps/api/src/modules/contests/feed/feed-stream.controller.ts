import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { ApiNdjsonStream } from '@libs/common';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { FeedLineResponse } from './dto/feed-frame.response';
import { FeedStreamService } from './feed-stream.service';

/** Under the events prefix: nginx serves it unbuffered with a long read timeout (decisions.md). */
@Controller('api/internal/events/contests')
export class FeedStreamController {
  constructor(private readonly streams: FeedStreamService) {}

  /** The feed as a stream: the snapshot, then new events, one NDJSON line each. HTTP Basic like the snapshot URL. */
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
