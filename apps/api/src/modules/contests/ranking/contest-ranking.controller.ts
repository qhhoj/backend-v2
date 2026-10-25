import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { limiterAddress } from '@libs/common';
import { ContestRankingService } from './contest-ranking.service';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { RankingQueryDto } from './dto/ranking.dto';
import { RankingResponse } from './dto/ranking.response';

@ApiTags('Contests')
@Controller('api/internal/contests')
export class ContestRankingController {
  constructor(private readonly rankings: ContestRankingService) {}

  /**
   * Get the ranking of a contest
   *
   * @remarks
   * Returns the standings: each row's rank, score and per-problem cells
   * (`formatData`), with ties sharing a rank. Set `virtual` to include virtual
   * participations. Depending on the contest's scoreboard visibility the
   * viewer sees the full board, only their own row, or nothing (403
   * `forbidden`); non-editors see frozen standings during a freeze. A contest
   * ranking access code sent as `code` shows the full board whatever those
   * rules say, and wrong codes (403) are rate limited per IP. Boards of non-
   * editors are cached.
   */
  @Public()
  @Get(':key/ranking')
  ranking(
    @Param() { key }: ContestKeyParamDto,
    @Query() { virtual, code }: RankingQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ): Promise<RankingResponse> {
    return this.rankings.ranking(optionalPrincipal(auth), key, {
      withVirtual: virtual,
      rankingAccess:
        code === undefined
          ? undefined
          : { accessCode: code, ip: limiterAddress(request.ip) },
    });
  }
}
