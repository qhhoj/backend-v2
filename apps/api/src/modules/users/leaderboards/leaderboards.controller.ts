import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { UsernameParamDto } from '../core/dto/username-params.dto';
import {
  ContributorListQueryDto,
  RankQueryDto,
  UserListQueryDto,
} from './dto/leaderboard.dto';
import {
  LeaderboardEntryResponse,
  RankResponse,
} from './dto/leaderboard.response';
import { LeaderboardsService } from './leaderboards.service';

@Public()
@Controller('api/internal')
export class LeaderboardsController {
  constructor(private readonly leaderboards: LeaderboardsService) {}

  @ApiPaginatedResponse(LeaderboardEntryResponse)
  @Get('users')
  users(
    @Query() { sort, page, pageSize }: UserListQueryDto,
  ): Promise<Paginated<LeaderboardEntryResponse>> {
    return this.leaderboards.board(sort, page, pageSize);
  }

  @ApiPaginatedResponse(LeaderboardEntryResponse)
  @Get('contributors')
  contributors(
    @Query() { page, pageSize }: ContributorListQueryDto,
  ): Promise<Paginated<LeaderboardEntryResponse>> {
    return this.leaderboards.board('contributionPoints', page, pageSize);
  }

  @Get('users/:username/rank')
  rank(
    @Param() { username }: UsernameParamDto,
    @Query() { sort }: RankQueryDto,
  ): Promise<RankResponse> {
    return this.leaderboards.rankOf(username, sort);
  }
}
