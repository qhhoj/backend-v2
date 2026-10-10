import { ApiTags } from '@nestjs/swagger';
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
import { ApiFileResponse, RawResponse } from '@libs/common';
import { ContestDataService } from './contest-data.service';
import {
  ContestDataStatusResponse,
  PrepareDataDto,
} from './dto/contest-data.dto';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';

@ApiTags('Contest editing')
@Controller('api/internal/contests')
export class ContestDataController {
  constructor(private readonly data: ContestDataService) {}

  /**
   * Get the state of the contest data download
   *
   * @remarks
   * Contest editors only, once the contest has ended. Returns whether the zip
   * of the contest's problem data is `none`, `preparing` or `ready`, with its
   * size and when the next preparation is allowed. 404 when the feature is not
   * configured, 409 before the contest has ended.
   */
  @Get(':key/data')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestDataStatusResponse> {
    return this.data.status(auth.principal, key);
  }

  /**
   * Prepare the contest data download
   *
   * @remarks
   * Contest editors only, once the contest has ended. Queues building a zip of
   * the problems' data, optionally narrowed with `problemGlob` and including
   * the chosen `results`; returns 202. Fails with 409 `conflict` while a build
   * is running and 429 `rate_limited` since it can be prepared once a day.
   */
  @Post(':key/data')
  @HttpCode(202)
  prepare(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() body: PrepareDataDto,
  ): Promise<QueuedResponse> {
    return this.data.prepare(auth.principal, key, body);
  }

  /**
   * Download the contest data
   *
   * @remarks
   * Contest editors only, once the contest has ended. Streams the prepared zip
   * as an attachment; 404 `not_found` when none has been prepared.
   */
  @ApiFileResponse('application/zip')
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
