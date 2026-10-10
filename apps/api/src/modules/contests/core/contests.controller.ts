import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Contests')
@Controller('api/internal/contests')
export class ContestsController {
  constructor(private readonly contests: ContestsService) {}

  /**
   * List the contests visible to the viewer
   *
   * @remarks
   * Returns one page of contests the viewer may see, each row carrying the
   * signed-in viewer's own state in it. Anonymous callers see only visible
   * contests that are neither private nor organization-private. Filters are
   * `phase` (upcoming, running or ended), `tag`, `organization`, `rated`, and
   * `search` or `q` (case-insensitive key or name substring, ANDed together).
   * Upcoming contests are sorted soonest first, all other views newest first.
   * Paged with `page` and `pageSize` (default 50, at most 100).
   */
  @Public()
  @ApiPaginatedResponse(ContestListItemResponse)
  @Get()
  list(
    @Query() query: ContestListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<ContestListItemResponse>> {
    return this.contests.list(optionalPrincipal(auth), query);
  }

  /**
   * Get a contest by key
   *
   * @remarks
   * Returns the contest's description, rules, scoring settings, authors and
   * the viewer's own participation state. The problem list is null until the
   * viewer may see it (taking part, contest ended, or editor or tester), and
   * `settings` is only filled for viewers who can edit. Fails with 404
   * `not_found` for a malformed, unknown or invisible key alike, so existence
   * never leaks.
   */
  @Public()
  @Get(':key')
  detail(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<ContestDetailResponse> {
    return this.contests.detail(optionalPrincipal(auth), key);
  }
}
