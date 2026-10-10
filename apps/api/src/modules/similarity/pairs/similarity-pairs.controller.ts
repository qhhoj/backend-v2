import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, Paginated } from '@libs/common';
import { SimilarityRunParamDto } from '../runs/dto/run-params.dto';
import { SimilarityPairListDto } from './dto/pair-list.dto';
import { SimilarityPairParamDto } from './dto/pair-params.dto';
import { SimilarityPairDetailResponse } from './dto/similarity-pair-detail.response';
import { SimilarityPairResponse } from './dto/similarity-pair.response';
import { SimilarityPairsService } from './similarity-pairs.service';

@ApiTags('Judging')
@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity')
export class SimilarityPairsController {
  constructor(private readonly pairs: SimilarityPairsService) {}

  /**
   * List the similar submission pairs of a run
   *
   * @remarks
   * Needs `judge.moss_contest` and edit rights on the run's scope. Returns one
   * page (`page`, `pageSize` up to 100), most similar first. Filter by
   * `problemId`, `language` (engine family such as `cpp`) and `minSimilarity` (0
   * to 1). Pairs on problems the viewer cannot see are left out. Unknown or
   * hidden runs are 404 `not_found`.
   */
  @ApiPaginatedResponse(SimilarityPairResponse)
  @Get('runs/:runId/pairs')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { runId }: SimilarityRunParamDto,
    @Query() query: SimilarityPairListDto,
  ): Promise<Paginated<SimilarityPairResponse>> {
    return this.pairs.list(auth.principal, runId, query);
  }

  /**
   * Get one similar pair with both sources
   *
   * @remarks
   * Needs `judge.moss_contest` and edit rights on the run's scope. Returns the
   * pair, both submitted sources and the matched fragments. It is 404
   * `not_found` unless the viewer could open both submissions' sources, so
   * nothing is shown that the submission routes would hide.
   */
  @Get('pairs/:pairId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { pairId }: SimilarityPairParamDto,
  ): Promise<SimilarityPairDetailResponse> {
    return this.pairs.detail(auth.principal, pairId);
  }
}
