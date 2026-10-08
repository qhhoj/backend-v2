import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, Paginated } from '@libs/common';
import { SimilarityRunParamDto } from '../runs/dto/run-params.dto';
import { SimilarityPairListDto } from './dto/pair-list.dto';
import { SimilarityPairParamDto } from './dto/pair-params.dto';
import { SimilarityPairDetailResponse } from './dto/similarity-pair-detail.response';
import { SimilarityPairResponse } from './dto/similarity-pair.response';
import { SimilarityPairsService } from './similarity-pairs.service';

@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity')
export class SimilarityPairsController {
  constructor(private readonly pairs: SimilarityPairsService) {}

  @ApiPaginatedResponse(SimilarityPairResponse)
  @Get('runs/:runId/pairs')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { runId }: SimilarityRunParamDto,
    @Query() query: SimilarityPairListDto,
  ): Promise<Paginated<SimilarityPairResponse>> {
    return this.pairs.list(auth.principal, runId, query);
  }

  @Get('pairs/:pairId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { pairId }: SimilarityPairParamDto,
  ): Promise<SimilarityPairDetailResponse> {
    return this.pairs.detail(auth.principal, pairId);
  }
}
