import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ScopeQueryDto } from '../core/dto/scope-query.dto';
import { SimilarityRunResponse } from '../core/dto/similarity-run.response';
import { SimilarityRunParamDto } from './dto/run-params.dto';
import { SimilarityRunsService } from './similarity-runs.service';

@ApiTags('Judging')
@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity/runs')
export class SimilarityRunsController {
  constructor(private readonly runs: SimilarityRunsService) {}

  /**
   * List recent similarity runs of a problem or contest
   *
   * @remarks
   * Needs `judge.moss_contest` and edit rights on the scope. Give exactly one of
   * the `problem` (code) or `contest` (key) query parameters. Returns the 10
   * newest runs, newest first, with their status, limits and per-language
   * groups. Unknown or not editable scopes are 404 `not_found`.
   */
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ScopeQueryDto,
  ): Promise<SimilarityRunResponse[]> {
    return this.runs.list(auth.principal, query);
  }

  /**
   * Get a similarity run
   *
   * @remarks
   * Needs `judge.moss_contest` and edit rights on the run's scope. Returns the
   * status (`queued`, `running`, `done` or `failed`), the error code for a
   * failed run, the limits used and the compared groups, plus languages that
   * could not be compared. Unknown, malformed and hidden ids are all 404
   * `not_found`.
   */
  @Get(':runId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { runId }: SimilarityRunParamDto,
  ): Promise<SimilarityRunResponse> {
    return this.runs.detail(auth.principal, runId);
  }
}
