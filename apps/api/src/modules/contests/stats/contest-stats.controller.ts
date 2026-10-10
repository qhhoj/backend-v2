import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestStatsService } from './contest-stats.service';
import { ContestStatsResponse } from './dto/contest-stats.response';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';

@ApiTags('Contests')
@Controller('api/internal/contests')
export class ContestStatsController {
  constructor(private readonly stats: ContestStatsService) {}

  /**
   * Get the statistics of a contest
   *
   * @remarks
   * Returns result counts per problem and per language. Subject to the same
   * rule as the full submission list, so it fails with 403 `forbidden` while
   * the viewer may not see that list.
   */
  @Public()
  @Get(':key/stats')
  get(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<ContestStatsResponse> {
    return this.stats.statsOf(optionalPrincipal(auth), key);
  }
}
