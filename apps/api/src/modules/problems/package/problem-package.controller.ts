import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiFileResponse } from '@libs/common';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import {
  PackageBuildingResponse,
  PackageStatusResponse,
} from './dto/package-status.response';
import { ProblemPackageService } from './problem-package.service';

/** Seconds the editor's button waits between polls while a build runs. */
const BUILDING_RETRY_AFTER_SECONDS = '5';

/** The `{ data }` envelope these `@Res()` routes spell out themselves (the plain `@Res()` hides the handler's return type from the plugin). */
const enveloped = (model: Type) => ({
  type: 'object' as const,
  required: ['data'],
  properties: { data: { $ref: getSchemaPath(model) } },
});

@Controller('api/internal/problems')
export class ProblemPackageController {
  constructor(private readonly packages: ProblemPackageService) {}

  /** 200 `{data: {status: 'ready', key}}` when the current package is cached, 202 `{data: {status: 'building', key}}` when a build is queued or running. Plain `@Res()` because the status depends on the answer. */
  @ApiExtension('x-enveloped', true)
  @ApiExtraModels(PackageStatusResponse)
  @ApiResponse({
    status: 200,
    description: 'The current package is cached.',
    schema: enveloped(PackageStatusResponse),
  })
  @ApiResponse({
    status: 202,
    description: 'A build is queued or running; poll `GET` on the same path.',
    schema: enveloped(PackageStatusResponse),
  })
  @Post(':code/package')
  async request(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const status = await this.packages.request(auth, code);
    return reply
      .code(status.status === 'ready' ? 200 : 202)
      .header('Cache-Control', 'no-store')
      .send({ data: status });
  }

  /** 200 the zip (attachment), 202 while building, 404 `package_not_built`, 409 `package_too_large`, 503 `package_unavailable`. */
  @ApiExtension('x-enveloped', true)
  @ApiExtraModels(PackageBuildingResponse)
  @ApiFileResponse('application/zip')
  @ApiResponse({
    status: 202,
    description: 'Still building (see Retry-After).',
    schema: enveloped(PackageBuildingResponse),
  })
  @Get(':code/package')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const location = await this.packages.locate(auth.principal, code);
    if (location.status === 'building')
      return reply
        .code(202)
        .header('Retry-After', BUILDING_RETRY_AFTER_SECONDS)
        .header('Cache-Control', 'no-store')
        .send({ data: { status: 'building' } });
    const { file, filename } = location;
    try {
      const { size } = await file.stat();
      return reply
        .type('application/zip')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', size)
        .header('Cache-Control', 'private, no-store')
        .send(file.createReadStream());
    } catch (error) {
      await file.close();
      throw error;
    }
  }
}
