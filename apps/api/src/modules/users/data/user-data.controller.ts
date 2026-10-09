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

@Controller('api/internal/profile/data')
export class UserDataController {
  constructor(private readonly data: UserDataService) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext): Promise<UserDataStatusResponse> {
    return this.data.status(auth.principal);
  }

  @Post()
  @HttpCode(202)
  @NoImpersonation()
  prepare(@CurrentAuth() auth: AuthContext): Promise<QueuedResponse> {
    return this.data.prepare(auth.principal);
  }

  /** Always an attachment with `nosniff`; the username is not trusted to be ASCII. */
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
