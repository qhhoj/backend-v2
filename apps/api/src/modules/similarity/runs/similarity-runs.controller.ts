import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ScopeQueryDto } from '../core/dto/scope-query.dto';
import { SimilarityRunResponse } from '../core/dto/similarity-run.response';
import { SimilarityRunParamDto } from './dto/run-params.dto';
import { SimilarityRunsService } from './similarity-runs.service';

@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity/runs')
export class SimilarityRunsController {
  constructor(private readonly runs: SimilarityRunsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ScopeQueryDto,
  ): Promise<SimilarityRunResponse[]> {
    return this.runs.list(auth.principal, query);
  }

  @Get(':runId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { runId }: SimilarityRunParamDto,
  ): Promise<SimilarityRunResponse> {
    return this.runs.detail(auth.principal, runId);
  }
}
