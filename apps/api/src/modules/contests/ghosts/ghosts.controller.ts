import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Res,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiFileResponse, RawResponse } from '@libs/common';
import { GHOST_CSV_MAX_BYTES } from '@libs/contests';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import {
  GhostImportResponse,
  GhostListResponse,
  ImportGhostsDto,
} from './dto/ghosts.dto';
import { GhostsService } from './ghosts.service';

@Controller('api/internal/contests/:key/ghosts')
export class GhostsController {
  constructor(private readonly ghosts: GhostsService) {}

  /** The whole request body is capped at `GHOST_CSV_MAX_BYTES` (Fastify answers 413 beyond it). */
  @Put()
  @RouteConfig({ bodyLimit: GHOST_CSV_MAX_BYTES })
  importCsv(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: ImportGhostsDto,
  ): Promise<GhostImportResponse> {
    return this.ghosts.importCsv(auth.principal, key, dto);
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<GhostListResponse> {
    return this.ghosts.list(auth.principal, key);
  }

  @ApiFileResponse('text/csv')
  @RawResponse()
  @Get('csv')
  async csv(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const file = await this.ghosts.csv(auth.principal, key);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store');
    return file.text;
  }

  @Delete()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.ghosts.remove(auth.principal, key);
  }
}
