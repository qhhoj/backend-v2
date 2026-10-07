import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
    @Query() { virtual, code }: RankingQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ): Promise<RankingResponse> {
    return this.rankings.ranking(
      optionalPrincipal(auth),
      key,
      virtual,
      code === undefined ? undefined : { code, ip: request.ip },
    );
  }
}
