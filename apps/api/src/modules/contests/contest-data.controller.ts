import type { ReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { ContestDataService } from './contest-data.service';
import {
  ContestDataStatusResponse,
  PrepareDataDto,
} from './dto/contest-data.dto';
import { ContestKeyParamDto } from './dto/contest-params.dto';
import { QueuedResponse } from './dto/queued.response';

@Controller('api/internal/contests')
export class ContestDataController {
  constructor(private readonly data: ContestDataService) {}

  @Get(':key/data')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestDataStatusResponse> {
    return this.data.status(auth.principal, key);
  }

  @Post(':key/data')
  @HttpCode(202)
  prepare(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() body: PrepareDataDto,
  ): Promise<QueuedResponse> {
    return this.data.prepare(auth.principal, key, body);
  }

  /** Always an attachment with `nosniff`; the file name is the contest key (`[a-z0-9_]`), nothing to escape. */
  @RawResponse()
  @Get(':key/data/download')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadStream> {
    const file = await this.data.download(auth.principal, key);
    reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('X-Content-Type-Options', 'nosniff');
    return file.stream;
  }
}
