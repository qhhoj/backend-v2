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

@Controller('api/internal/contests/:key/replay')
export class ReplayController {
  constructor(private readonly replays: ReplayService) {}

  /** `private`: the body depends on who asks (freeze), so no shared cache may keep it. A `building` answer is 202 and never cached. */
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

  @Post('rebuild')
  @HttpCode(202)
  rebuild(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.replays.rebuild(auth.principal, key);
  }
}
