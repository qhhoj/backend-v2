import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ContestsService } from './contests.service';
import { ContestDetailResponse } from './dto/contest-detail.response';
import { ContestListQueryDto } from './dto/contest-list.dto';
import { ContestListItemResponse } from './dto/contest-list.response';
import { ContestKeyParamDto } from './dto/contest-params.dto';

@Controller('api/internal/contests')
export class ContestsController {
  constructor(private readonly contests: ContestsService) {}

  @Public()
  @ApiPaginatedResponse(ContestListItemResponse)
  @Get()
  list(
    @Query() query: ContestListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<ContestListItemResponse>> {
    return this.contests.list(optionalPrincipal(auth), query);
  }

  @Public()
  @Get(':key')
  detail(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<ContestDetailResponse> {
    return this.contests.detail(optionalPrincipal(auth), key);
  }
}
