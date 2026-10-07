import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, REDIS } from '@libs/common';
import { canonicalTimeZone, isTimeZone } from '@libs/community';
import { uuidStr } from '@libs/database';
import { PP_ENTRIES, PP_STEP } from '@libs/judging';
import type Redis from 'ioredis';
import { ContestAccess } from '../../contests/core/contest-access';
import { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { ProblemGroupsQuerier } from '../../problems/catalog/problem-groups.querier';
import { LeaderboardsRepository } from '../leaderboards/leaderboards.repository';
import { ActivityQueryDto, PpBreakdownQueryDto } from './dto/user-page.dto';
import type {
  ActivityResponse,
  PpEntryResponse,
  RatingHistoryEntryResponse,
  SolvedResponse,
  UserPageResponse,
} from './dto/user-page.response';
import { UserPagesRepository } from './user-pages.repository';

const ACTIVITY_DAYS = 365;
const CACHE_SECONDS = 600;
const notFound = () => new AppError('not_found', 404, 'No such user');

@Injectable()
export class UserPagesService {
  constructor(
    private readonly users: UsersRepository,
    private readonly pages: UserPagesRepository,
    private readonly leaderboards: LeaderboardsRepository,
    private readonly organizations: OrganizationsService,
    private readonly languages: LanguagesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async userOf(username: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw notFound();
    return user;
  }

  /** Legacy `UserPage`/`UserAboutPage` header. */
  async page(
    principal: Principal | null,
    username: string,
  ): Promise<UserPageResponse> {
    const user = await this.userOf(username);
    const [above, ratingAbove, ratingSummary, organizations] =
      await Promise.all([
        this.leaderboards.countAbove(
          'performancePoints',
          user.performancePoints,
        ),
        user.rating === null
          ? Promise.resolve(null)
          : this.leaderboards.countAbove('rating', user.rating),
        this.pages.ratingSummary(user._id),
        this.organizations.listedFor(
          principal,
          user.organizations.map(uuidStr),
        ),
      ]);
    return {
      id: user._id,
      username: user.username,
      displayName: user.usernameDisplayOverride || user.username,
      displayRank: user.displayRank,
      aboutHtml: user.aboutHtml,
      points: user.points,
      performancePoints: user.performancePoints,
      problemCount: user.problemCount,
      contributionPoints: user.contributionPoints,
      rating: user.rating,
      rank: above + 1,
      ratingRank: ratingAbove === null ? null : ratingAbove + 1,
      ratingSummary,
      organizations: organizations.map((organization) =>
        OrganizationSummaryResponse.from(organization),
      ),
      dateJoined: user.dateJoined,
    };
  }

  /** Every rating of the user (legacy); names only for contests the viewer may see. */
  async ratings(
    principal: Principal | null,
    username: string,
  ): Promise<RatingHistoryEntryResponse[]> {
    const user = await this.userOf(username);
    const history = await this.pages.ratingHistory(
      user._id,
      ContestAccess.visibleFilter(principal),
    );
    return history.map(({ rating, contest }) => ({
      contestKey: contest?.key ?? null,
      contestName: contest?.name ?? null,
      endTime: rating.contestEndTime,
      rating: rating.rating,
      rank: rating.rank,
      performance: rating.performance,
    }));
  }

  async solved(username: string): Promise<SolvedResponse> {
    const user = await this.userOf(username);
    const byGroup = new Map<string, SolvedResponse['groups'][number]>();
    for (const row of await this.pages.solved(user._id)) {
      const name =
        this.groups.byId(uuidStr(row.problem.groupId))?.fullName ?? '';
      const group = byGroup.get(name) ?? { name, points: 0, problems: [] };
      group.points += row.points;
      group.problems.push({
        code: row.problem.code,
        name: row.problem.name,
        points: row.points,
        total: row.problem.points,
      });
      byGroup.set(name, group);
    }
    const groups = [...byGroup.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const group of groups)
      group.problems.sort((left, right) => left.code.localeCompare(right.code));
    return { groups };
  }

  /** Legacy `UserPerformancePointsAjax`: weights only exist for the first 300 entries, so those are computed once and cached per user. */
  async ppBreakdown(
    username: string,
    { page, pageSize }: PpBreakdownQueryDto,
  ): Promise<Paginated<PpEntryResponse>> {
    const user = await this.userOf(username);
    const entries = await this.ppEntries(user._id);
    const start = (page - 1) * pageSize;
    return new Paginated(entries.slice(start, start + pageSize), {
      page,
      pageSize,
      hasMore: start + pageSize < entries.length,
    });
  }

  /** Legacy heatmap over the last 365 days, per day in the viewer's zone, cached 10 minutes per user and zone. */
  async activity(
    principal: Principal | null,
    username: string,
    query: ActivityQueryDto,
    now = new Date(),
  ): Promise<ActivityResponse> {
    const user = await this.userOf(username);
    // Echo the asked spelling; the aggregate and the cache key use ICU's canonical ID (unknown zones are already a 400, mis-cased ones never reach Mongo).
    const timezone = query.timezone ?? (await this.viewerZone(principal));
    const zone = canonicalTimeZone(timezone)!;
    const key = `user-activity:${user._id}:${zone}`;
    const cached = await this.redis.get(key);
    if (cached)
      return { ...(JSON.parse(cached) as ActivityResponse), timezone };
    const since = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000);
    const rows = await this.pages.activity(user._id, since, zone);
    const response: ActivityResponse = {
      timezone,
      since: since.toISOString(),
      days: Object.fromEntries(rows.map((row) => [row._id, row.count])),
    };
    await this.redis.set(key, JSON.stringify(response), 'EX', CACHE_SECONDS);
    return response;
  }

  private async ppEntries(userId: string): Promise<PpEntryResponse[]> {
    const key = `user-pp:${userId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as PpEntryResponse[];
    const entries = (await this.pages.ppBreakdown(userId, PP_ENTRIES)).map(
      (row, index): PpEntryResponse => {
        const weight = PP_STEP ** index;
        const language = this.languages.byId(uuidStr(row.submission.language));
        return {
          rank: index + 1,
          weight: weight * 100,
          points: row.submission.points,
          scaledPoints: row.submission.points * weight,
          problem: { code: row.problem.code, name: row.problem.name },
          submission: {
            id: uuidStr(row.submission._id),
            date: row.submission.date.toISOString(),
            casePoints: row.submission.casePoints,
            caseTotal: row.submission.caseTotal,
            result: row.submission.result,
            language: language?.shortName || language?.key || '',
          },
        };
      },
    );
    await this.redis.set(key, JSON.stringify(entries), 'EX', CACHE_SECONDS);
    return entries;
  }

  private async viewerZone(principal: Principal | null): Promise<string> {
    const zone =
      principal && (await this.users.findById(principal.userId))?.timezone;
    return isTimeZone(zone) ? zone : 'UTC';
  }
}
