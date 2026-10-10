import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth, Public } from '@libs/auth';
import { ApiEventStream } from '@libs/common';
import type { AuthContext } from '@libs/auth';
import { ResyncFrame } from '../../events/dto/resync-frame.response';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { ContestAnnouncementFrame } from './dto/contest-stream-frames.response';
import { ContestStreamsService } from './contest-streams.service';

/** Server-sent events; see `SubmissionStreamsController`. */
@ApiTags('Live events')
@Controller('api/internal/events/contests')
export class ContestStreamsController {
  constructor(private readonly streams: ContestStreamsService) {}

  /**
   * Stream live events of a contest
   *
   * @remarks
   * Server-sent events (`text/event-stream`) for anyone who can see the
   * contest. The `announcement` event carries the id of a new or resent
   * announcement, and `resync` tells the client its subscription was lost and
   * it should reload the list. Nothing is sent until an event happens apart
   * from heartbeat comments every 15 seconds; the client reconnects after the
   * advertised 3 second retry delay. Open streams are capped per user, per IP
   * and in total (429 `rate_limited`).
   */
  @ApiEventStream(ContestAnnouncementFrame, ResyncFrame)
  @Public()
  @Get(':key')
  async contest(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.streams.openContest(auth ?? null, key, request, reply);
  }
}
