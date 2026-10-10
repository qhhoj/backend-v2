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
import { ApiTags } from '@nestjs/swagger';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  ApiFileResponse,
  ApiFileUpload,
  ApiTextResponse,
  RawResponse,
} from '@libs/common';
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

@ApiTags('Problem editing')
@Controller('api/internal/problems')
export class ProblemDataController {
  constructor(
    private readonly data: ProblemDataService,
    private readonly uploads: ProblemDataUploadService,
  ) {}

  /**
   * Get the test data configuration of a problem
   *
   * @remarks
   * Needs edit rights on the problem. Returns the checker, grader, limits,
   * uploaded file names, the list of test cases, the members of the archive and
   * the last `init.yml` generation error. Problems managed manually are 404
   * `not_found` here.
   */
  @Get(':code/data')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ProblemDataResponse> {
    return this.data.get(auth, code);
  }

  /**
   * Replace the test data configuration of a problem
   *
   * @remarks
   * Needs edit rights; mirror problems are refused (403) because they use their
   * source problem's data. Send the whole configuration, including every test
   * case (at most 300, or 9999 with `judge.create_mass_testcases`; body up to 8
   * MiB). The server regenerates `init.yml`; a configuration problem is reported
   * in `feedback`, not as an error. Responds 409 `conflict` when the data
   * changed meanwhile, so reload and retry.
   */
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

  /**
   * Get the generated init.yml of a problem
   *
   * @remarks
   * Needs edit rights on the problem. Returns the judge configuration file
   * generated from the test data as `text/yaml`. Responds 404 `not_found` when
   * none was generated, for example because of a configuration error.
   */
  @RawResponse()
  @ApiTextResponse('text/yaml')
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

  /**
   * Upload the test data archive of a problem
   *
   * @remarks
   * Needs edit rights; mirror problems are refused. Send one multipart `file`, a
   * .zip of up to 512 MiB (400 `zip_required` or a zip error code otherwise). It
   * replaces the previous archive, regenerates `init.yml` and is counted against
   * the organization's storage and credits (403 `quota_exceeded`). Limited to 30
   * uploads per hour per user. Returns the new data configuration.
   */
  @ApiFileUpload()
  @Post(':code/data/archive')
  uploadArchive(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    return this.uploads.uploadArchive(auth, code, request);
  }

  /**
   * Upload a generator, checker, grader or header file
   *
   * @remarks
   * Needs edit rights; mirror problems are refused. `kind` is `generator`,
   * `customChecker`, `customGrader` or `customHeader`; send one multipart `file`
   * of up to 1 MiB whose extension fits the kind (400 `extension_not_allowed`).
   * It replaces the previous file of that kind and returns the new data
   * configuration. Shares the upload budget of 30 per hour per user.
   */
  @ApiFileUpload()
  @Post(':code/data/files/:kind')
  uploadSource(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, kind }: DataSourceKindParamDto,
    @Req() request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    return this.uploads.uploadSource(auth, code, kind, request);
  }

  /**
   * Remove an uploaded data file
   *
   * @remarks
   * Needs edit rights; mirror problems are refused. `kind` is `archive`,
   * `generator`, `customChecker`, `customGrader` or `customHeader`. Clears the
   * setting, regenerates `init.yml` and deletes the file. Returns the new data
   * configuration.
   */
  @Delete(':code/data/files/:kind')
  deleteFile(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, kind }: DataFileKindParamDto,
  ): Promise<ProblemDataResponse> {
    return this.data.deleteFile(auth, code, kind);
  }

  /**
   * Download an uploaded test data file
   *
   * @remarks
   * Needs edit rights on the problem. Always sent as an attachment with
   * `X-Content-Type-Options: nosniff`, so the browser never renders it. An
   * unknown or unsafe file name is 404 `not_found`.
   */
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
