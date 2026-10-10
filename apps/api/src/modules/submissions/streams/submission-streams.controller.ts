import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
@ApiTags('Live events')
@Controller('api/internal/events/submissions')
export class SubmissionStreamsController {
  constructor(private readonly streams: SubmissionStreamsService) {}

  /**
   * Stream the public submission feed
   *
   * @remarks
   * Public Server-Sent Events stream (`text/event-stream`). Emits `queued`,
   * `processing`, `grading-begin` and `done` for the submissions the anonymous
   * submission list shows, with
   * `{ submissionId, userId, problemId, type, status }` as data; per-case
   * progress is never sent. A `resync` event means events may have been missed,
   * so reload the list. A `: ping` comment is sent every 15 seconds and the
   * stream asks clients to retry after 3 seconds, so `EventSource` reconnects by
   * itself. Open streams are capped per client IP and per server (429
   * `rate_limited`).
   */
  @Public()
  @ApiEventStream(SubmissionFeedFrame, ResyncFrame)
  @Get()
  feed(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.streams.openFeed(request, reply);
  }

  /**
   * Stream the live judging progress of one submission
   *
   * @remarks
   * Needs a signed-in user who may see the submission's detail (same access
   * rules and 404 or 403 errors). Server-Sent Events (`text/event-stream`): a
   * `state` event first with the current status, result and points, then
   * `queued`, `processing`, `grading-begin` and `done` events, and `test-case`
   * events only when the viewer may see every case result. `resync` means events
   * may have been missed, so reload the submission. Heartbeat `: ping` every 15
   * seconds. Access is re-checked every minute and the stream closes when it is
   * lost. Open streams are capped per user and per client IP (429
   * `rate_limited`).
   */
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
