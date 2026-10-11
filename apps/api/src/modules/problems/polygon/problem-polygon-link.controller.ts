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

@ApiTags('Problem editing')
@RequirePermission('judge.import_polygon_package')
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
   * Needs `judge.import_polygon_package` and write access to the problem's test
   * data. Returns the link (Polygon id, synced revision and package, last sync
   * time, result and error, auto-sync switch) and Polygon's newest package,
   * which is null when Polygon cannot be asked. Errors: 404 `not_found`, 404
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
   * Needs `judge.import_polygon_package` and write access to the problem's test
   * data. Queues the import job in sync mode on the newest READY package:
   * statement, tutorial, tests, checker and limits are overwritten; code,
   * points, group, types, authors, curators and allowed languages are kept.
   * The result is recorded on the link. Answers 202 with a `jobId` to poll at
   * `GET /problems/imports/{jobId}`. Counts towards the 10 imports an hour per
   * user. Errors: 404 `polygon_not_linked`, 409 `polygon_package_not_ready`,
   * 409 `polygon_not_connected`, 502/503 Polygon errors, 429 `rate_limited`.
   */
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
   * Needs `judge.import_polygon_package` and write access to the problem's test
   * data. Every finished Polygon import and sync job of the problem, newest
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
   * Switch a problem's Polygon auto-sync
   *
   * @remarks
   * Needs `judge.import_polygon_package` and write access to the problem's test
   * data. With `autoSync` on, the worker checks Polygon every 10 minutes and
   * syncs a newer READY package, except while a contest using the problem is
   * running. Writes a problem revision. Errors: 404 `polygon_not_linked`, 409
   * `conflict` when the link changed meanwhile.
   */
  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() { autoSync }: UpdatePolygonLinkDto,
  ): Promise<PolygonLinkResponse> {
    return this.links.setAutoSync(auth, code, autoSync);
  }

  /**
   * Unlink a problem from Polygon
   *
   * @remarks
   * Needs `judge.import_polygon_package` and write access to the problem's test
   * data. Removes the link only; statement, tests and every other field stay.
   * Writes a problem revision. Answers 204. Errors: 404 `polygon_not_linked`,
   * 409 `conflict` when the link changed meanwhile.
   */
  @Delete()
  @HttpCode(204)
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<void> {
    return this.links.unlink(auth, code);
  }
}
