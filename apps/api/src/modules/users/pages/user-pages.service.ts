import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  canonicalTimeZone,
  isTimeZone,
  Paginated,
  REDIS,
} from '@libs/common';
import type { HasMorePageMetaResponse } from '@libs/common';
import { uuidStr } from '@libs/database';
import { PP_ENTRIES, PP_STEP } from '@libs/judging';
import type Redis from 'ioredis';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestViewerService } from '../../contests/core/contest-viewer.service';
import { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { ProblemGroupsQuerier } from '../../problems/catalog/problem-groups.querier';
import { SubmissionsService } from '../../submissions/core/submissions.service';
import { LeaderboardsRepository } from '../leaderboards/leaderboards.repository';
import { ActivityQueryDto, PpBreakdownQueryDto } from './dto/user-page.dto';
import type {
  ActivityResponse,
  PpEntryResponse,
  RatingHistoryEntryResponse,
  SolvedResponse,
  UserPageResponse,
  UserPageStaffResponse,
} from './dto/user-page.response';
import { UserPagesRepository } from './user-pages.repository';

const ACTIVITY_DAYS = 365;
const CACHE_SECONDS = 600;
/** Min, max and count over the ratings the viewer may read. */
const summarize = (
  history: Array<{ rating: { rating: number }; readable: boolean }>,
): UserPageResponse['ratingSummary'] => {
  const values = history
    .filter((entry) => entry.readable)
    .map((entry) => entry.rating.rating);
  return values.length
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        contests: values.length,
      }
    : null;
};
const notFound = () => new AppError('not_found', 404, 'No such user');
/** Judges who may ban see why a user is banned, whether they are a superuser and whether the account was ever activated. */
const staffViewOf = (
  principal: Principal | null,
  user: { isSuperuser: boolean; isActive: boolean; banReason: string | null },
): UserPageStaffResponse | null =>
  principal && hasPermission(principal, 'judge.ban_user')
    ? {
        isSuperuser: user.isSuperuser,
        isActive: user.isActive,
        banReason: user.banReason,
      }
    : null;

@Injectable()
export class UserPagesService {
  constructor(
    private readonly users: UsersRepository,
    private readonly pages: UserPagesRepository,
    private readonly leaderboards: LeaderboardsRepository,
    private readonly organizations: OrganizationsService,
    private readonly languages: LanguagesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    private readonly contestViewers: ContestViewerService,
    private readonly submissions: SubmissionsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** A renamed account still answers to its old name while no account holds it; the response carries the current name. */
  private async userOf(username: string) {
    const user =
      (await this.users.findByUsername(username)) ??
      (await this.users.findByPreviousUsername(username));
    if (!user) throw notFound();
    return user;
  }

  /** Legacy `UserPage`/`UserAboutPage` header. */
  async page(
    principal: Principal | null,
    username: string,
    now = new Date(),
  ): Promise<UserPageResponse> {
    const user = await this.userOf(username);
    const [above, ratingAbove, history, organizations, submissionCount] =
      await Promise.all([
        this.leaderboards.countAbove(
          'performancePoints',
          user.performancePoints,
        ),
        user.rating === null
          ? Promise.resolve(null)
          : this.leaderboards.countAbove('rating', user.rating),
        this.readableHistory(principal, user._id, now),
        this.organizations.listedFor(
          principal,
          user.organizations.map(uuidStr),
        ),
        this.submissions.count(principal, { userIds: [user._id] }),
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
      submissionCount,
      contributionPoints: user.contributionPoints,
      rating: user.rating,
      rank: above + 1,
      ratingRank: ratingAbove === null ? null : ratingAbove + 1,
      ratingSummary: summarize(history),
      organizations: organizations.map((organization) =>
        OrganizationSummaryResponse.from(organization),
      ),
      dateJoined: user.dateJoined,
      staff: staffViewOf(principal, user),
    };
  }

  /** Every rating of the user (legacy); names only for contests the viewer may see, results only for boards they may read. */
  async ratings(
    principal: Principal | null,
    username: string,
    now = new Date(),
  ): Promise<RatingHistoryEntryResponse[]> {
    const user = await this.userOf(username);
    const history = await this.readableHistory(principal, user._id, now);
    return history.map(({ rating, contest, readable }) => ({
      contestKey: contest?.key ?? null,
      contestName: contest?.name ?? null,
      endTime: rating.contestEndTime,
      rating: readable ? rating.rating : null,
      rank: readable ? rating.rank : null,
      performance: readable ? rating.performance : null,
    }));
  }

  /** Each rating with its contest (null when the viewer may not see it) and whether the viewer may read the contest's board. */
  private async readableHistory(
    principal: Principal | null,
    userId: string,
    now: Date,
  ) {
    const history = await this.pages.ratingHistory(userId);
    return history.map(({ rating, contest }) => {
      const view = contest && ContestAccess.accessView(contest);
      return {
        rating,
        contest: view && ContestAccess.canSee(principal, view) ? contest : null,
        readable: !!view && ContestAccess.boardReadable(principal, view, now),
      };
    });
  }

  /** Contests whose submissions the anonymous submission list hides now (running, frozen, hidden board, private): the public pages leave them out, whoever views. */
  private hiddenContests(): Promise<string[]> {
    return this.contestViewers.hiddenSubmissionContests(null, new Date());
  }

  async solved(username: string): Promise<SolvedResponse> {
    const user = await this.userOf(username);
    const byGroup = new Map<string, SolvedResponse['groups'][number]>();
    const rows = await this.pages.solved(user._id, await this.hiddenContests());
    for (const row of rows) {
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
  ): Promise<Paginated<PpEntryResponse, HasMorePageMetaResponse>> {
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
    if (query.timezone) return this.activityIn(user._id, query.timezone, now);
    // A stored zone Mongo cannot use must not break the viewer's pages: fall back to UTC.
    const stored = await this.viewerZone(principal);
    try {
      return await this.activityIn(user._id, stored, now);
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 400) throw error;
      return this.activityIn(user._id, 'UTC', now);
    }
  }

  private async activityIn(
    userId: string,
    timezone: string,
    now: Date,
  ): Promise<ActivityResponse> {
    // Echo the asked spelling; the aggregate and the cache key use ICU's canonical ID (unknown zones are already a 400, mis-cased ones never reach Mongo).
    const zone = canonicalTimeZone(timezone)!;
    const key = `user-activity:${userId}:${zone}`;
    const cached = await this.redis.get(key);
    if (cached)
      return { ...(JSON.parse(cached) as ActivityResponse), timezone };
    const since = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000);
    const rows = await this.pages.activity(userId, since, zone);
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
    const rows = await this.pages.ppBreakdown(
      userId,
      PP_ENTRIES,
      await this.hiddenContests(),
    );
    const entries = rows.map((row, index): PpEntryResponse => {
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
    });
    await this.redis.set(key, JSON.stringify(entries), 'EX', CACHE_SECONDS);
    return entries;
  }

  private async viewerZone(principal: Principal | null): Promise<string> {
    const zone =
      principal && (await this.users.findById(principal.userId))?.timezone;
    return isTimeZone(zone) ? zone : 'UTC';
  }
}
