import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiFileResponse, ApiFileUpload, RawResponse } from '@libs/common';
import { DATA_BODY_LIMIT_BYTES } from '../core/dto/limits';
import {
  DataFileKindParamDto,
  DataFileNameParamDto,
  DataSourceKindParamDto,
  PutProblemDataDto,
} from './dto/problem-data.dto';
import { ProblemDataResponse } from './dto/problem-data.response';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { ProblemDataWriteGuard } from './problem-data-write.guard';
import { ProblemDataService } from './problem-data.service';
import { ProblemDataUploadService } from './problem-data-upload.service';

@Controller('api/internal/problems')
export class ProblemDataController {
  constructor(
    private readonly data: ProblemDataService,
    private readonly uploads: ProblemDataUploadService,
  ) {}

  @Get(':code/data')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ProblemDataResponse> {
    return this.data.get(auth, code);
  }

  @UseGuards(ProblemDataWriteGuard)
  @RouteConfig({ bodyLimit: DATA_BODY_LIMIT_BYTES })
  @Put(':code/data')
  put(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: PutProblemDataDto,
  ): Promise<ProblemDataResponse> {
    return this.data.put(auth, code, body);
  }

  @RawResponse()
  @Get(':code/data/init')
  async init(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const yaml = await this.data.init(auth, code);
    reply.type('text/yaml; charset=utf-8');
    return yaml;
  }

  @ApiFileUpload()
  @Post(':code/data/archive')
  uploadArchive(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    return this.uploads.uploadArchive(auth, code, request);
  }

  @ApiFileUpload()
  @Post(':code/data/files/:kind')
  uploadSource(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, kind }: DataSourceKindParamDto,
    @Req() request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    return this.uploads.uploadSource(auth, code, kind, request);
  }

  @Delete(':code/data/files/:kind')
  deleteFile(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, kind }: DataFileKindParamDto,
  ): Promise<ProblemDataResponse> {
    return this.data.deleteFile(auth, code, kind);
  }

  /** Always an attachment with `nosniff`: uploaded files are never rendered by the browser. */
  @ApiFileResponse('application/octet-stream')
  @RawResponse()
  @Get(':code/data/files/:name')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, name }: DataFileNameParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadStream> {
    const file = await this.data.download(auth, code, name);
    reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('X-Content-Type-Options', 'nosniff');
    return createReadStream(file.path);
  }
}
