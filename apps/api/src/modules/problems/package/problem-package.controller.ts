import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  ApiTags,
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

@ApiTags('Problem editing')
@Controller('api/internal/problems')
export class ProblemPackageController {
  constructor(private readonly packages: ProblemPackageService) {}

  /**
   * Request a downloadable package of a problem
   *
   * @remarks
   * Needs edit rights on the problem. Asks for a zip of the problem as it is now
   * (statement and test data). 200 `{ data: { status: 'ready', key } }` means
   * the package is cached and `GET` on the same path returns it; 202
   * `{ data: { status: 'building', key } }` means a build is queued or running,
   * so poll `GET`. Every request counts against 3 per problem and 10 in total
   * per user per hour (429 `rate_limited`). Responds 409 `package_too_large`
   * when the package is over the size limit.
   */
  // Plain `@Res()` because the status (200 or 202) depends on the answer.
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

  /**
   * Download the package of a problem
   *
   * @remarks
   * Needs edit rights on the problem. 200 returns the cached zip as an
   * attachment named `<code>.zip`; 202 `{ data: { status: 'building' } }` with
   * `Retry-After` means the build is still running. Other outcomes: 404
   * `package_not_built` when no package was requested for the current data, 409
   * `package_too_large`, 503 `package_unavailable` with `Retry-After` when the
   * build failed. Polling is free of rate limits.
   */
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
