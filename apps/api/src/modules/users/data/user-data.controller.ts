import { ApiTags } from '@nestjs/swagger';
import type { ReadStream } from 'node:fs';
import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, NoImpersonation } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiFileResponse, RawResponse } from '@libs/common';
import type { QueuedResponse } from '../../contests/core/dto/queued.response';
import { attachmentHeader } from './attachment-header';
import type { UserDataStatusResponse } from './dto/user-data.response';
import { UserDataService } from './user-data.service';

@ApiTags('Account')
@Controller('api/internal/profile/data')
export class UserDataController {
  constructor(private readonly data: UserDataService) {}

  /**
   * Get the state of my data export
   *
   * @remarks
   * Signed-in callers only. Reports whether a zip of the caller's own data is being prepared, ready to download or absent, with its size, when it expires (7 days after it is written) and when a new export may be requested. 404 `not_found` when exports are switched off on this server or the account is muted.
   */
  @Get()
  status(@CurrentAuth() auth: AuthContext): Promise<UserDataStatusResponse> {
    return this.data.status(auth.principal);
  }

  /**
   * Request an export of my data
   *
   * @remarks
   * Signed-in callers only, not while impersonating. Queues a background job that builds a zip of the caller's data and answers 202 `{queued: true}`. Allowed once a day while a fresh zip exists, and at most 3 times a day in total.
   * Errors: 409 `conflict` while an export is already being prepared, 429 `rate_limited` when asking again within a day or past the daily cap, 404 `not_found` when exports are unavailable.
   */
  @Post()
  @HttpCode(202)
  @NoImpersonation()
  prepare(@CurrentAuth() auth: AuthContext): Promise<QueuedResponse> {
    return this.data.prepare(auth.principal);
  }

  /**
   * Download my data export
   *
   * @remarks
   * Signed-in callers only, not while impersonating. Streams the prepared zip as an attachment (`application/zip`, `nosniff`). 404 `not_found` when no unexpired export exists.
   */
  @ApiFileResponse('application/zip')
  @RawResponse()
  @NoImpersonation()
  @Get('download')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadStream> {
    const file = await this.data.download(auth.principal);
    reply
      .type('application/zip')
      .header('Content-Disposition', attachmentHeader(file.filename))
      .header('X-Content-Type-Options', 'nosniff');
    return file.stream;
  }
}
