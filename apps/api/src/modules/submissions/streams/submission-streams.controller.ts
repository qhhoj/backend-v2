import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth, Public } from '@libs/auth';
import { ApiEventStream } from '@libs/common';
import type { AuthContext } from '@libs/auth';
import { ResyncFrame } from '../../events/dto/resync-frame.response';
import { SubmissionIdParamDto } from '../core/dto/submission-params.dto';
import {
  SubmissionFeedFrame,
  SubmissionProgressFrame,
  SubmissionStateFrame,
} from './dto/submission-stream-frames.response';
import { SubmissionStreamsService } from './submission-streams.service';

/** Server-sent events. Plain `@Res()`: the service hijacks the reply; errors thrown before that reach the exception filter as usual. */
@Controller('api/internal/events/submissions')
export class SubmissionStreamsController {
  constructor(private readonly streams: SubmissionStreamsService) {}

  /** Public feed: `queued`, `processing`, `grading-begin` and `done` of submissions on public, non-organisation-private problems, as ids and status. */
  @Public()
  @ApiEventStream(SubmissionFeedFrame, ResyncFrame)
  @Get()
  feed(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.streams.openFeed(request, reply);
  }

  /** One submission, gated like its detail: `state` first, then its events (`test-case` only when every case result is visible), `resync` after a lost subscription. */
  @ApiEventStream(SubmissionProgressFrame, SubmissionStateFrame, ResyncFrame)
  @Get(':id')
  submission(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.streams.openSubmission(auth, id, request, reply);
  }
}
