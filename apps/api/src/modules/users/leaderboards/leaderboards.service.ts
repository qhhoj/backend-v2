import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { competitionRanks } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { LeaderboardField } from '@libs/database';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { LEADERBOARD_PAGE_SIZE } from './dto/leaderboard.dto';
import {
  LeaderboardEntryResponse,
  RankResponse,
} from './dto/leaderboard.response';
import { LeaderboardsRepository } from './leaderboards.repository';

@Injectable()
export class LeaderboardsService {
  constructor(
    private readonly leaderboards: LeaderboardsRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Legacy `UserList` (and `ContribList` with `contributionPoints`). */
  async board(
    field: LeaderboardField,
    page: number,
    pageSize: number,
  ): Promise<Paginated<LeaderboardEntryResponse>> {
    const [rows, total] = await Promise.all([
      this.leaderboards.page(field, page, pageSize),
      this.leaderboards.count(),
    ]);
    const values = rows.map((row) => row[field]);
    const firstRank = rows.length
      ? (await this.leaderboards.countAbove(field, values[0])) + 1
      : 1;
    const ranks = competitionRanks(values, firstRank);
    const listed = new Map(
      (
        await this.organizations.findByIds(
          unique(rows.flatMap((row) => row.organizations.map(uuidStr))),
        )
      )
        .filter((organization) => !organization.isUnlisted)
        .map((organization) => [uuidStr(organization._id), organization]),
    );
    return new Paginated(
      rows.map((row, index) =>
        LeaderboardEntryResponse.from(
          row,
          ranks[index],
          row.organizations
            .map(uuidStr)
            .map((id) => listed.get(id))
            .find(Boolean) ?? null,
        ),
      ),
      { page, pageSize, total },
    );
  }

  /** Legacy `user_ranking_redirect` / `user_contributor_redirect`. */
  async rankOf(
    username: string,
    field: LeaderboardField,
  ): Promise<RankResponse> {
    const user = await this.users.findByUsername(username);
    if (!user || user.isUnlisted || !user.isActive)
      throw new AppError(
        'not_found',
        404,
        'That user is not on the leaderboard',
      );
    const value = user[field];
    const [above, tiedBefore] = await Promise.all([
      this.leaderboards.countAbove(field, value),
      this.leaderboards.countTiedBefore(field, value, user._id),
    ]);
    return {
      rank: above + 1,
      page: Math.floor((above + tiedBefore) / LEADERBOARD_PAGE_SIZE) + 1,
      pageSize: LEADERBOARD_PAGE_SIZE,
    };
  }
}
