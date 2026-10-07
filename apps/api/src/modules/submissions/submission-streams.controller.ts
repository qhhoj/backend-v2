import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../contests/dto/contest-params.dto';
import { SubmissionIdParamDto } from './dto/submission-params.dto';
import { SubmissionStreamsService } from './submission-streams.service';

/** Server-sent events. Plain `@Res()`: the service hijacks the reply; errors thrown before that reach the exception filter as usual. */
@Controller('api/internal/events')
export class SubmissionStreamsController {
  constructor(private readonly streams: SubmissionStreamsService) {}

  /** Public feed: `queued`, `processing`, `grading-begin` and `done` of submissions on public, non-organisation-private problems, as ids and status. */
  @Public()
  @Get('submissions')
  feed(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.streams.openFeed(request, reply);
  }

  /** One submission, gated like its detail: `state` first, then its events (`test-case` only when every case result is visible), `resync` after a lost subscription. */
  @Get('submissions/:id')
  submission(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.streams.openSubmission(auth, id, request, reply);
  }

  /** Contest announcements as ids (`announcement`), for anyone who sees the contest; `resync` after a lost subscription. */
  @Public()
  @Get('contests/:key')
  async contest(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.streams.openContest(auth ?? null, key, request, reply);
  }
}
