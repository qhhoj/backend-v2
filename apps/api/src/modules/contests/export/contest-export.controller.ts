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

@Controller('api/internal/contests')
export class ContestExportController {
  constructor(private readonly exports: ContestExportService) {}

  @Get(':key/export')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestExportStatusResponse> {
    return this.exports.status(auth.principal, key);
  }

  @Post(':key/export')
  @HttpCode(202)
  request(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.exports.request(auth.principal, key);
  }

  /** Always an attachment with `nosniff`; the file name is the contest key (`[a-z0-9_]`), nothing to escape. */
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
      .header('X-Content-Type-Options', 'nosniff');
    return file.stream;
  }
}
