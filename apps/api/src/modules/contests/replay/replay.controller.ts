import { ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';
import { ReplayQueryDto, ReplayResponse } from './dto/replay.dto';
import { ReplayService } from './replay.service';

@ApiTags('Contests')
@Controller('api/internal/contests/:key/replay')
export class ReplayController {
  constructor(private readonly replays: ReplayService) {}

  /**
   * Get the replay of a contest
   *
   * @remarks
   * Returns the ended contest's ranking over time in chunks. Chunk 0 (the
   * default) carries participants, problems, ghosts and a `buildId`; later
   * chunks need that `build` id so a reader never mixes builds. When no replay
   * is stored yet it answers 202 with state `building` and queues a single
   * build, so poll again after a few seconds. Refusals are 403 when the board
   * is hidden or frozen for the viewer, 409 `contest_not_ended`,
   * `replay_unsupported` (final-submission format) or `replay_changed`, 404
   * `replay_not_ready` or `replay_chunk_not_found`, and 400
   * `replay_build_required`. Responses are cached privately for 60 seconds.
   */
  @Public()
  @Get()
  async replay(
    @Param() { key }: ContestKeyParamDto,
    @Query() { chunk, build }: ReplayQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReplayResponse> {
    const body = await this.replays.read(optionalPrincipal(auth), key, {
      chunk,
      build,
    });
    if (body.state === 'building')
      reply.status(202).header('Cache-Control', 'no-store');
    else reply.header('Cache-Control', 'private, max-age=60');
    return body;
  }

  /**
   * Rebuild the replay of a contest
   *
   * @remarks
   * Contest editors only, after the contest has ended. Queues a rebuild of the
   * stored replay, waiting for the settle time when the end is recent. Limited
   * to a few rebuilds per hour per editor (429 `rate_limited`); fails with 503
   * `replay_unavailable` when the queue is down. Returns 202.
   */
  @Post('rebuild')
  @HttpCode(202)
  rebuild(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.replays.rebuild(auth.principal, key);
  }
}
