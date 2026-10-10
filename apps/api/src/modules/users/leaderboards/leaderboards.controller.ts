import { ApiTags } from '@nestjs/swagger';
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
@ApiTags('Users')
@Controller('api/internal')
export class LeaderboardsController {
  constructor(private readonly leaderboards: LeaderboardsService) {}

  /**
   * List users on the leaderboard
   *
   * @remarks
   * Public. Pages of 100 listed, active users ranked by `sort` (`rating` by default, or `performancePoints`, `points`, `problemCount`, `contributionPoints`). Ties share a rank. Each entry carries the user's first listed organization.
   */
  @ApiPaginatedResponse(LeaderboardEntryResponse)
  @Get('users')
  users(
    @Query() { sort, page, pageSize }: UserListQueryDto,
  ): Promise<Paginated<LeaderboardEntryResponse>> {
    return this.leaderboards.board(sort, page, pageSize);
  }

  /**
   * List top contributors
   *
   * @remarks
   * Public. Pages of users ranked by contribution points, with the same entry shape as the user leaderboard.
   */
  @ApiPaginatedResponse(LeaderboardEntryResponse)
  @Get('contributors')
  contributors(
    @Query() { page, pageSize }: ContributorListQueryDto,
  ): Promise<Paginated<LeaderboardEntryResponse>> {
    return this.leaderboards.board('contributionPoints', page, pageSize);
  }

  /**
   * Find a user's leaderboard position
   *
   * @remarks
   * Public. Returns the user's rank for the chosen `sort` field and the page (with its page size) of the leaderboard that holds them. 404 `not_found` for an unknown, unlisted, banned or never-activated user.
   */
  @Get('users/:username/rank')
  rank(
    @Param() { username }: UsernameParamDto,
    @Query() { sort }: RankQueryDto,
  ): Promise<RankResponse> {
    return this.leaderboards.rankOf(username, sort);
  }
}
