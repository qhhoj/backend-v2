import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { ContestStreamsService } from './contest-streams.service';

/** Server-sent events; see `SubmissionStreamsController`. */
@Controller('api/internal/events/contests')
export class ContestStreamsController {
  constructor(private readonly streams: ContestStreamsService) {}

  /** Contest announcements as ids (`announcement`), for anyone who sees the contest; `resync` after a lost subscription. */
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
