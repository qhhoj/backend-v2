import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ScopeQueryDto } from '../core/dto/scope-query.dto';
import { StartedSimilarityRunResponse } from './dto/started-run.response';
import { SimilarityStartService } from './similarity-start.service';

@ApiTags('Judging')
@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity/runs')
export class SimilarityStartController {
  constructor(private readonly starts: SimilarityStartService) {}

  /**
   * Start a code similarity check
   *
   * @remarks
   * Needs `judge.moss_contest` and edit rights on the scope. Give exactly one of
   * `problem` (code) or `contest` (key) in the body (400 `scope_required`); an
   * unknown or not editable scope is 404 `not_found`. A background job compares
   * the submitted sources of the scope using the limits in the site settings at
   * this moment. Responds 409 `conflict` while the scope has a run in progress
   * and 429 `rate_limited` after 10 starts per hour per user. Answers 202 with
   * the new `runId`; poll `GET /similarity/runs/{runId}`.
   */
  @Post()
  @HttpCode(202)
  start(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ScopeQueryDto,
  ): Promise<StartedSimilarityRunResponse> {
    return this.starts.start(auth.principal, dto);
  }
}
