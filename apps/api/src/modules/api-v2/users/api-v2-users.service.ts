import { Injectable } from '@nestjs/common';
import type { FilterQuery } from 'mongoose';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { isFrozen, standingOf } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { ParticipationsRepository } from '../../contests/core/participations.repository';
import { RatingsRepository } from '../../contests/rating/ratings.repository';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import { LeaderboardsRepository } from '../../users/leaderboards/leaderboards.repository';
import type { LeaderboardRow } from '../../users/leaderboards/leaderboards.repository';
import { UserPagesRepository } from '../../users/pages/user-pages.repository';
import {
  API_V2_PAGE_SIZE,
  legacyPage,
  legacyTotalPages,
} from '../core/legacy-envelope';
import type { LegacyPage } from '../core/legacy-envelope';
import { ApiV2UserListDto } from './dto/api-v2-user-list.dto';

const notFound = () => new AppError('not_found', 404, 'page/object not found');

@Injectable()
export class ApiV2UsersService {
  constructor(
    private readonly leaderboards: LeaderboardsRepository,
    private readonly pages: UserPagesRepository,
    private readonly users: UsersRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly contests: ContestsRepository,
    private readonly participations: ParticipationsRepository,
    private readonly ratings: RatingsRepository,
  ) {}

  /** Legacy `APIUserList`; `organization` matches only organizations the viewer may see enumerated. */
  async list(
    principal: Principal | null,
    query: ApiV2UserListDto,
  ): Promise<LegacyPage<Record<string, unknown>>> {
    const filter: FilterQuery<User> = {};
    if (query.id) filter._id = { $in: query.id };
    if (query.username) filter.username = { $in: query.username };
    if (query.organization) {
      const listable = (
        await this.organizations.findByIds(query.organization)
      ).filter((organization) =>
        OrganizationAccess.canList(
          principal,
          OrganizationAccess.accessView(organization),
        ),
      );
      filter.organizations = {
        $in: listable.map((organization) => uuidStr(organization._id)),
      };
    }
    const { items, total } = await this.leaderboards.legacyPage(
      filter,
      query.page,
      API_V2_PAGE_SIZE,
    );
    if (query.page > legacyTotalPages(total)) throw notFound();
    return legacyPage(
      items.map((user) => this.summary(user)),
      query.page,
      total,
    );
  }

  /** Legacy `APIUserDetail`. */
  async detail(
    principal: Principal | null,
    username: string,
    now = new Date(),
  ): Promise<Record<string, unknown>> {
    const user = await this.users.findByUsername(username);
    if (!user) throw notFound();
    const [solved, organizations, contests] = await Promise.all([
      this.pages.solvedCodes(user._id),
      this.organizationsService.listedFor(
        principal,
        user.organizations.map(uuidStr),
      ),
      this.contestHistory(principal, user._id, now),
    ]);
    return {
      ...this.summary(user),
      solved_problems: solved,
      organizations: organizations.map((organization) =>
        uuidStr(organization._id),
      ),
      contests,
    };
  }

  private summary(
    user: Pick<
      LeaderboardRow,
      | '_id'
      | 'username'
      | 'points'
      | 'performancePoints'
      | 'problemCount'
      | 'displayRank'
      | 'rating'
    >,
  ): Record<string, unknown> {
    return {
      id: uuidStr(user._id),
      username: user.username,
      points: user.points,
      performance_points: user.performancePoints,
      problem_count: user.problemCount,
      rank: user.displayRank,
      rating: user.rating,
    };
  }

  /** Live participations in visible, ended contests whose board the viewer may read, by end time; frozen standings and no ratings for non-editors of a frozen board. */
  private async contestHistory(
    principal: Principal | null,
    userId: string,
    now: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = new Map(
      (await this.participations.liveRowsOf(userId)).map((row) => [
        uuidStr(row.contest),
        row,
      ]),
    );
    if (!rows.size) return [];
    const contests = (
      await this.contests.findAll({
        $and: [
          ContestAccess.visibleFilter(principal),
          ContestAccess.scoreboardFilter(principal, now),
          { _id: { $in: [...rows.keys()] } },
          { endTime: { $lt: now } },
        ],
      })
    ).sort((left, right) => left.endTime.getTime() - right.endTime.getTime());
    const ratings = await this.ratings.byParticipation(
      contests.map((contest) => uuidStr(rows.get(uuidStr(contest._id))!._id)),
    );
    return contests.map((contest) => {
      const row = rows.get(uuidStr(contest._id))!;
      const standing = standingOf(
        row,
        isFrozen(contest, now) &&
          !ContestAccess.canEdit(principal, ContestAccess.accessView(contest)),
      );
      const rating = ratings.get(uuidStr(row._id));
      return {
        key: contest.key,
        score: standing.score,
        cumulative_time: standing.cumtime,
        rating: rating?.rating ?? null,
        raw_rating: rating?.mean ?? null,
        performance: rating?.performance ?? null,
      };
    });
  }
}
