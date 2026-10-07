import { Controller, Get, Param } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestStatsService } from './contest-stats.service';
import { ContestStatsResponse } from './dto/contest-stats.response';
import { ContestKeyParamDto } from './dto/contest-params.dto';

@Controller('api/internal/contests')
export class ContestStatsController {
  constructor(private readonly stats: ContestStatsService) {}

  @Public()
  @Get(':key/stats')
  get(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<ContestStatsResponse> {
    return this.stats.statsOf(optionalPrincipal(auth), key);
  }
}
