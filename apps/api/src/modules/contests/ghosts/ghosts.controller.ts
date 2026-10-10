import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/ghosts')
export class GhostsController {
  constructor(private readonly ghosts: GhostsService) {}

  /**
   * Import ghost participants from CSV
   *
   * @remarks
   * Contest editors only. Replaces the contest's ghosts (reference teams shown
   * in the replay) with the rows of the CSV, with columns label, caption and
   * then one per contest problem code (a cell is minute, optionally with
   * points before an at sign and rejected tries after a plus sign). The whole
   * request body is capped (413 beyond it). Use `dryRun` to validate and
   * preview without storing and `anonymize` to relabel ghosts as Ghost 001 and
   * so on. Fails with 400 `ghost_import_invalid` listing the row issues, or
   * 409 `ghost_unsupported_format` for final-submission contests. Once the
   * contest has ended a replay rebuild is queued.
   */
  @Put()
  @RouteConfig({ bodyLimit: GHOST_CSV_MAX_BYTES })
  importCsv(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: ImportGhostsDto,
  ): Promise<GhostImportResponse> {
    return this.ghosts.importCsv(auth.principal, key, dto);
  }

  /**
   * List the ghosts of a contest
   *
   * @remarks
   * Contest editors only. Returns the stored ghosts with their per-problem
   * cells.
   */
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<GhostListResponse> {
    return this.ghosts.list(auth.principal, key);
  }

  /**
   * Download the ghosts as CSV
   *
   * @remarks
   * Contest editors only. Returns the current ghost set in the import grammar
   * as a `text/csv` attachment, to edit and upload again.
   */
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

  /**
   * Delete all ghosts of a contest
   *
   * @remarks
   * Contest editors only. Removes every ghost and returns 204; a replay
   * rebuild is queued when the contest has ended.
   */
  @Delete()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.ghosts.remove(auth.principal, key);
  }
}
