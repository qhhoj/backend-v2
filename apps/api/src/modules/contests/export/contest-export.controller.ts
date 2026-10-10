import { ApiTags } from '@nestjs/swagger';
import type { ReadStream } from 'node:fs';
import { Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiFileResponse, RawResponse } from '@libs/common';
import { ContestExportService } from './contest-export.service';
import { ContestExportStatusResponse } from './dto/contest-export.dto';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';

@ApiTags('Contest editing')
@Controller('api/internal/contests')
export class ContestExportController {
  constructor(private readonly exports: ContestExportService) {}

  /**
   * Get the state of the contest export
   *
   * @remarks
   * Contest editors only, once the contest has ended. Returns whether the zip
   * of every contestant's submissions is `none`, `preparing` or `ready`, with
   * its size and when the next preparation is allowed. Fails with 404 when
   * exports are not configured and 409 `contest_not_ended` before the end.
   */
  @Get(':key/export')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestExportStatusResponse> {
    return this.exports.status(auth.principal, key);
  }

  /**
   * Request a contest export
   *
   * @remarks
   * Contest editors only, once the contest has ended. Queues preparation of
   * the zip and returns 202. Fails with 409 `export_in_progress` while one is
   * being prepared and 429 `export_rate_limited` since it can be prepared once
   * a day.
   */
  @Post(':key/export')
  @HttpCode(202)
  request(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.exports.request(auth.principal, key);
  }

  /**
   * Download the contest export
   *
   * @remarks
   * Contest editors only, once the contest has ended. Streams the prepared zip
   * as a private attachment; 404 `export_not_prepared` when no export exists.
   */
  @ApiFileResponse('application/zip')
  @RawResponse()
  @Get(':key/export/download')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadStream> {
    const file = await this.exports.download(auth.principal, key);
    reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return file.stream;
  }
}
