import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, Paginated } from '@libs/common';
import { PolygonClient } from '@libs/problems';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { PolygonProblemResponse } from './dto/polygon-problem.response';
import {
  PolygonLinkImportDto,
  PolygonProblemLinkDto,
} from './dto/polygon-problems.dto';
import { PolygonStatusResponse } from './dto/polygon-status.response';
import { PolygonSyncRunResponse } from './dto/polygon-sync-run.response';
import { PolygonSyncRunsQueryDto } from './dto/polygon-sync-runs.dto';
import { PolygonLinkImportService } from './polygon-link-import.service';
import { PolygonLinkResolver } from './polygon-link-resolver.service';
import { PolygonSyncHistoryService } from './polygon-sync-history.service';

@ApiTags('Problem editing')
@RequirePermission('judge.import_polygon_package')
@Controller('api/internal/polygon')
export class PolygonController {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly resolver: PolygonLinkResolver,
    private readonly linkImports: PolygonLinkImportService,
    private readonly history: PolygonSyncHistoryService,
  ) {}

  /**
   * Get whether the Polygon account is connected
   *
   * @remarks
   * Needs `judge.import_polygon_package`. `connected` is true when both the API
   * key and secret are set in the admin settings; `accountName` is the Polygon
   * login setters add as a READ co-author (empty when unset). No call to Polygon
   * is made. The secret is never returned.
   */
  @Get('status')
  status(): PolygonStatusResponse {
    return {
      connected: this.polygon.isConnected(),
      accountName: this.polygon.accountName(),
    };
  }

  /**
   * Check a Polygon problem link and preview the problem
   *
   * @remarks
   * Needs `judge.import_polygon_package`. The body takes the problem page
   * address, `https://polygon.codeforces.com/p…/owner/name`; its `p…` part is
   * the permission: the server finds `owner/name` among the problems shared
   * with the QHHOJ account and compares the token with the `<problem url>` of
   * the newest READY package's problem.xml (read once per problem, then
   * cached). Answers the problem, its statement title and the newest READY
   * package (`type` full or standard). Each check, here or on import, counts
   * towards 20 per 10 minutes per user. Errors: 400 `polygon_link_invalid`
   * (not a problem link), 404 `polygon_link_refused` (not shared with the account, or the token does not
   * match: one answer for both), 409 `polygon_no_package` (no READY package to
   * check against), `polygon_package_not_ready` (newest package not READY),
   * `polygon_already_linked` (names the QHHOJ problem, also as
   * `linkedProblemCode`, only to a user who may edit it) or
   * `polygon_not_connected`, 502/503 Polygon errors, 429 `rate_limited`.
   */
  @Post('resolve')
  @HttpCode(200)
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Body() { link }: PolygonProblemLinkDto,
  ): Promise<PolygonProblemResponse> {
    return this.resolver.preview(auth, link);
  }

  /**
   * List the Polygon sync history of every problem
   *
   * @remarks
   * Needs `judge.import_polygon_package` and `judge.edit_all_problem` (the
   * runs name every problem). Every finished Polygon import and sync job, newest
   * first: problem code, Polygon problem, revision, package and its build time,
   * first import or sync, manual or automatic, who started it, the result and,
   * for a failure, the step it stopped at and the error shown to the requester.
   * Paged, default 20 per page (max 100). Errors: 403 `forbidden`.
   */
  @ApiPaginatedResponse(PolygonSyncRunResponse)
  @Get('syncs')
  syncs(
    @CurrentAuth() auth: AuthContext,
    @Query() query: PolygonSyncRunsQueryDto,
  ): Promise<Paginated<PolygonSyncRunResponse>> {
    return this.history.all(auth, query);
  }

  /**
   * Import a Polygon problem and link it
   *
   * @remarks
   * Needs `judge.import_polygon_package`, plus `judge.add_problem` to create a
   * problem or write access to the problem to update it. The body takes the
   * problem `link` (checked again as on `POST /polygon/resolve`, with the same
   * errors), the zip import's options (`code`, `mode`, `organization`,
   * authors, curators, group, types, points, statement languages, zero-point
   * and main-solution switches) and `autoSync`. A created problem is private,
   * with the importer as a curator; with `organization` it belongs to that
   * organization as in the zip import (its creation rights replace
   * `judge.add_problem`, code prefix, credits). The server downloads the newest full package itself and the
   * same background job as the zip import applies it, then links the problem
   * to Polygon and records the import in the sync history. Answers 202 with a
   * `jobId` to poll at `GET /problems/imports/{jobId}` (its `step` goes queued,
   * downloading, statements, tests, done or failed). Counts towards the 10
   * imports an hour per user. Errors: 400 `code_taken`, the link errors of
   * `POST /polygon/resolve`, 429 `rate_limited`.
   */
  @Post('import')
  @HttpCode(202)
  importProblem(
    @CurrentAuth() auth: AuthContext,
    @Body() body: PolygonLinkImportDto,
  ): Promise<ImportJobStartedResponse> {
    return this.linkImports.importProblem(auth, body);
  }
}
