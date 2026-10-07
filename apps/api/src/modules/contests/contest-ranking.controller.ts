import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestRankingService } from './contest-ranking.service';
import { ContestKeyParamDto } from './dto/contest-params.dto';
import { RankingQueryDto } from './dto/ranking.dto';
import { RankingResponse } from './dto/ranking.response';

@Controller('api/internal/contests')
export class ContestRankingController {
  constructor(private readonly rankings: ContestRankingService) {}

  @Public()
  @Get(':key/ranking')
  ranking(
    @Param() { key }: ContestKeyParamDto,
    @Query() { virtual }: RankingQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<RankingResponse> {
    return this.rankings.ranking(optionalPrincipal(auth), key, virtual);
  }
}
