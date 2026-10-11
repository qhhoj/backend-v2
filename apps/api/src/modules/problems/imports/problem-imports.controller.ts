import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ApiFileUpload } from '@libs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ImportJobResponse } from './dto/import-job.response';
import {
  ImportJobParamDto,
  PolygonImportQueryDto,
} from './dto/problem-import.dto';
import { ImportJobStartedResponse } from './dto/import-job-started.response';
import { ProblemImportsService } from './problem-imports.service';

@ApiTags('Problem editing')
@Controller('api/internal/problems/imports')
export class ProblemImportsController {
  constructor(private readonly imports: ProblemImportsService) {}

  /**
   * Import a Polygon package as a new or existing problem
   *
   * @remarks
   * Needs `judge.import_polygon_package`; creating a problem also needs
   * `judge.add_problem`, updating needs write access to the problem's test data.
   * Without `judge.import_polygon_package`, an organization problem creator
   * may only create for an organization (`organization` required, no
   * `update`; else 403 `forbidden`).
   * Send the Polygon package as a multipart `file` (a zip with `problem.xml` at
   * its root, up to 512 MiB) and the options in the query string: `code`, `mode`
   * (`create` or `update`), `organization`, authors, curators, group, types,
   * points, statement language mapping and the zero-point and main-solution
   * switches. A create with `organization` (a slug) makes the problem private
   * to that organization under the rules of
   * `POST /organizations/{slug}/problems` instead of `judge.add_problem`: its
   * rights (404 unknown organization, 403 `forbidden`), the code prefix (400
   * `organization_code_prefix`), its credits (spent when the job is queued,
   * kept if the job fails later) and its storage. The package
   * is checked, then imported by a background job; the answer is 202 with a
   * `jobId` to poll at `GET /problems/imports/{jobId}`. Limited to 10 imports
   * per hour per user. Errors: 400 `code_taken`, 400 for a bad package
   * (`no_problem_xml` or a zip error code), 403 `quota_exceeded`, 413
   * `file_too_large`, 429 `rate_limited`.
   */
  @ApiFileUpload()
  @Post()
  @HttpCode(202)
  start(
    @CurrentAuth() auth: AuthContext,
    @Query() query: PolygonImportQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<ImportJobStartedResponse> {
    return this.imports.start(auth, query, request);
  }

  /**
   * Get the state of a Polygon import job
   *
   * @remarks
   * Needs `judge.import_polygon_package`, or the right to create problems for an organization (`judge.create_organization_problem` and an administered organization). Returns the job state (`waiting`,
   * `active`, `completed`, `failed`, ...), the imported problem when completed,
   * and the error written for the requester when it failed. Only the user who
   * started the job, or a superuser, can read it; anyone else gets the same 404
   * `not_found` as for an unknown id. Finished jobs stay readable for a day.
   */
  @Get(':jobId')
  async status(
    @CurrentAuth() auth: AuthContext,
    @Param() { jobId }: ImportJobParamDto,
  ): Promise<ImportJobResponse> {
    await this.imports.assertMayImport(auth.principal);
    return this.imports.status(auth, jobId);
  }
}
