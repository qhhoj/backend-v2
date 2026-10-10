import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { PolygonClient } from '@libs/problems';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { PolygonProblemResponse } from './dto/polygon-problem.response';
import {
  PolygonLinkImportDto,
  PolygonProblemParamDto,
  PolygonProblemsQueryDto,
} from './dto/polygon-problems.dto';
import { PolygonStatusResponse } from './dto/polygon-status.response';
import { PolygonCatalogService } from './polygon-catalog.service';
import { PolygonLinkImportService } from './polygon-link-import.service';

@ApiTags('Problem editing')
@RequirePermission('judge.import_polygon_package')
@Controller('api/internal/polygon')
export class PolygonController {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly catalog: PolygonCatalogService,
    private readonly linkImports: PolygonLinkImportService,
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
   * List the Polygon problems shared with the QHHOJ account
   *
   * @remarks
   * Needs `judge.import_polygon_package`. Every problem the account can read,
   * with its newest package (`READY`, `RUNNING`, `FAILED` or `NONE`), its
   * statement title and the code of the QHHOJ problem already linked to it.
   * `search` matches id, name, title or owner; `state` keeps one package state.
   * The list is cached for 60 seconds and titles for a day per revision;
   * `refresh=true` skips the list cache and is limited to 6 a minute per user.
   * Errors: 409 `polygon_not_connected`, 502 `polygon_unauthorized`,
   * `polygon_clock_skew` or `polygon_failed`, 503 `polygon_unavailable`,
   * 429 `rate_limited`.
   */
  @Get('problems')
  problems(
    @CurrentAuth() auth: AuthContext,
    @Query() query: PolygonProblemsQueryDto,
  ): Promise<PolygonProblemResponse[]> {
    return this.catalog.list(auth, query);
  }

  /**
   * Import a Polygon problem and link it
   *
   * @remarks
   * Needs `judge.import_polygon_package`, plus `judge.add_problem` to create a
   * problem or write access to the problem to update it. The body takes the zip
   * import's options (`code`, `mode`, authors, curators, group, types, points,
   * statement languages, zero-point and main-solution switches) and `autoSync`.
   * The server downloads the newest package itself and the same background job
   * as the zip import applies it, then links the problem to Polygon. Answers 202
   * with a `jobId` to poll at `GET /problems/imports/{jobId}` (its `step` goes
   * queued, downloading, statements, tests, done or failed). Counts towards the
   * 10 imports an hour per user. Errors: 400 `code_taken`, 404 `not_found` (not
   * shared with the account), 409 `polygon_package_not_ready`,
   * `polygon_already_linked` or `polygon_not_connected`, 502/503 Polygon errors,
   * 429 `rate_limited`.
   */
  @Post('problems/:polygonId/import')
  @HttpCode(202)
  importProblem(
    @CurrentAuth() auth: AuthContext,
    @Param() { polygonId }: PolygonProblemParamDto,
    @Body() body: PolygonLinkImportDto,
  ): Promise<ImportJobStartedResponse> {
    return this.linkImports.importProblem(auth, polygonId, body);
  }
}
