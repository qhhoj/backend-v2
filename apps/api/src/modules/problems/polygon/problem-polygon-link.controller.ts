import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, Paginated } from '@libs/common';
import { POLYGON_SYNC_PERMISSION } from '@libs/problems';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { UpdatePolygonLinkDto } from './dto/polygon-link.dto';
import {
  PolygonLinkResponse,
  PolygonLinkStateResponse,
} from './dto/polygon-link.response';
import { PolygonSyncRunResponse } from './dto/polygon-sync-run.response';
import { PolygonSyncRunsQueryDto } from './dto/polygon-sync-runs.dto';
import { PolygonLinkImportService } from './polygon-link-import.service';
import { PolygonLinkService } from './polygon-link.service';
import { PolygonSyncHistoryService } from './polygon-sync-history.service';

/** Every route needs write access to the problem's test data; the ones that change the problem or its link also need `judge.sync_polygon_problem`. */
@ApiTags('Problem editing')
@Controller('api/internal/problems/:code/polygon')
export class ProblemPolygonLinkController {
  constructor(
    private readonly links: PolygonLinkService,
    private readonly linkImports: PolygonLinkImportService,
    private readonly history: PolygonSyncHistoryService,
  ) {}

  /**
   * Get a problem's Polygon link
   *
   * @remarks
   * Needs write access to the problem's test data. Returns the link (Polygon id, synced revision and package, last sync
   * time, result and error, auto-sync switch), Polygon's newest package,
   * which is null when Polygon cannot be asked, and `runningJobId`, the queued
   * or running sync (or update import) of the problem to poll at
   * `GET /problems/imports/{jobId}`. Errors: 404 `not_found`, 404
   * `polygon_not_linked`, 403 `forbidden`.
   */
  @Get()
  state(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<PolygonLinkStateResponse> {
    return this.links.state(auth, code);
  }

  /**
   * Sync a linked problem from Polygon
   *
   * @remarks
   * Needs `judge.sync_polygon_problem` and write access to the problem's test
   * data. Queues the import job in sync mode on the newest READY package:
   * statement, tutorial, tests, checker and limits are overwritten; code,
   * points, group, types, authors, curators and allowed languages are kept.
   * The result is recorded on the link. Answers 202 with a `jobId` to poll at
   * `GET /problems/imports/{jobId}`; the id is one per problem and package, so
   * while a sync of that package (manual or automatic) is queued or running
   * the answer is that job, and nothing is spent. Every sync takes the link's
   * testcase limit, whoever starts it. The worker checks the package against the
   * storage of the organization an organization-private problem is charged to
   * (the package size minus the test data it replaces). Counts towards the 10 imports an hour per
   * user. Errors: 403 `forbidden`, 404 `polygon_not_linked`, 409
   * `polygon_package_not_ready`,
   * 409 `polygon_not_connected`, 502/503 Polygon errors, 429 `rate_limited`.
   */
  @RequirePermission(POLYGON_SYNC_PERMISSION)
  @Post('sync')
  @HttpCode(202)
  sync(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ImportJobStartedResponse> {
    return this.linkImports.sync(auth, code);
  }

  /**
   * List a problem's Polygon sync history
   *
   * @remarks
   * Needs write access to the problem's test data. Every finished Polygon import and sync job of the problem, newest
   * first, also after an unlink: revision, package and its build time, first
   * import or sync, manual or automatic, who started it, the result and, for a
   * failure, the step it stopped at and the error shown to the requester. Paged,
   * default 20 per page (max 100). Errors: 404 `not_found`, 403 `forbidden`.
   */
  @ApiPaginatedResponse(PolygonSyncRunResponse)
  @Get('syncs')
  syncs(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Query() query: PolygonSyncRunsQueryDto,
  ): Promise<Paginated<PolygonSyncRunResponse>> {
    return this.history.ofProblem(auth, code, query);
  }

  /**
   * Change a problem's Polygon auto-sync and import options
   *
   * @remarks
   * Needs `judge.sync_polygon_problem` and write access to the problem's test
   * data. Every field is optional; an omitted one keeps its value. With
   * `autoSync` on, the worker checks Polygon every 10 minutes and syncs a newer
   * READY package as the user who switched it on, except while a contest using
   * the problem is running; each run needs that user to still hold the
   * permission and the write access, else it fails and is recorded on the
   * link. The statement and test options apply from the next sync (manual or
   * automatic; one already queued keeps its own) and are checked against
   * Polygon's statements and tests first, with the codes a sync fails with
   * (400 `statement_language_required`, `statement_language_unmapped`,
   * `statement_language_repeated`, `tutorial_language_required`,
   * `too_many_testcases`, `params` as the job's `errorParams`); Polygon not
   * answering skips that check. The testcase limit (`options.maxCases`) is the
   * linking user's and is not editable. Writes a problem revision of the fields
   * that changed. Errors: 404 `polygon_not_linked`, 409 `conflict` when the
   * link changed meanwhile.
   */
  @RequirePermission(POLYGON_SYNC_PERMISSION)
  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: UpdatePolygonLinkDto,
  ): Promise<PolygonLinkResponse> {
    return this.links.update(auth, code, body);
  }

  /**
   * Unlink a problem from Polygon
   *
   * @remarks
   * Needs `judge.sync_polygon_problem` and write access to the problem's test
   * data. Removes the link only; statement, tests and every other field stay.
   * Writes a problem revision. Answers 204. Errors: 404 `polygon_not_linked`,
   * 409 `conflict` when the link changed meanwhile.
   */
  @RequirePermission(POLYGON_SYNC_PERMISSION)
  @Delete()
  @HttpCode(204)
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<void> {
    return this.links.unlink(auth, code);
  }
}
