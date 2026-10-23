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
  ImportJobsQueryDto,
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
   * Needs the rights of the change: creating a problem needs
   * `judge.add_problem` (or, with `organization`, that organization's creation
   * rights), updating needs write access to the problem's test data (else 403
   * `forbidden`). No Polygon-specific permission.
   * Send the Polygon package as a multipart `file` (a zip with `problem.xml` at
   * its root, up to 512 MiB) and the options in the query string: `code`, `mode`
   * (`create` or `update`), `organization`, authors, curators, group, types,
   * points, statement language mapping and the zero-point and main-solution
   * switches. A create with `organization` (a slug) makes the problem private
   * to that organization under the rules of
   * `POST /organizations/{slug}/problems` instead of `judge.add_problem`: its
   * rights (404 unknown organization, 403 `forbidden`), authors and curators
   * from its administrators only (else `judge.edit_all_problem`), the code prefix (400
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
   * List my Polygon imports and syncs
   *
   * @remarks
   * `mine=1` (required): the caller's import and sync jobs the queue still
   * keeps, running and finished in the last day, newest first, in the shape
   * of `GET /problems/imports/{jobId}`, so a setter can return to an import
   * after leaving its page.
   */
  @Get()
  mine(
    @CurrentAuth() auth: AuthContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- validated so the list is asked for explicitly with mine=1
    @Query() _query: ImportJobsQueryDto,
  ): Promise<ImportJobResponse[]> {
    return this.imports.mine(auth);
  }

  /**
   * Get the state of a Polygon import job
   *
   * @remarks
   * Returns the job state (`waiting`,
   * `active`, `completed`, `failed`, ...), its code, mode and purpose, its
   * place in the queue while it waits, the imported problem with a conversion
   * summary (checker mapping, tests, cases, batches, clamped limits) when
   * completed, or `result.attention` when the problem was imported but a file
   * step after the write failed (a sync repairs it), and, when it failed, the
   * error written for the requester with `errorCode`, `errorParams` and
   * `retryable` (whether the same request may pass later). An outage (Polygon
   * unreachable, no judge to generate tests) is retried once two minutes
   * later; the job is `delayed` meanwhile. The user who
   * started the job and a superuser can read it, and so can anyone with write
   * access to the test data of the problem an update (a sync too) imports
   * into; anyone else gets the same 404 `not_found` as for an unknown id. The
   * step and progress are shown only while the job runs. Finished jobs stay
   * readable for a day.
   */
  @Get(':jobId')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { jobId }: ImportJobParamDto,
  ): Promise<ImportJobResponse> {
    return this.imports.status(auth, jobId);
  }
}
