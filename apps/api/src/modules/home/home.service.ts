import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
import type { Principal } from '@libs/auth';
import { officialContestLocks, RECENT_COMMENTS_COUNT } from '@libs/community';
import type { LeaderboardField } from '@libs/database';
import type { RecentCommentResponse } from '../comments/core/dto/recent-comment.response';
import { RecentCommentsService } from '../comments/core/recent-comments.service';
import { LanguagesQuerier } from '../problems/catalog/languages.querier';
import { LeaderboardsRepository } from '../users/leaderboards/leaderboards.repository';
import type { HomeResponse, HomeUserResponse } from './dto/home.response';
import { HomeRepository } from './home.repository';

/** Legacy `DMOJ_BLOG_NEW_PROBLEM_COUNT` and `VNOJ_HOMEPAGE_TOP_USERS_COUNT`. */
export const HOME_NEW_PROBLEMS = 7;
export const HOME_TOP_USERS = 5;
/** Only the signed-out slice is shared; a signed-in viewer's depends on what they may read. */
export const ANONYMOUS_RECENT_COMMENTS_KEY = 'home:recent-comments';
export const ANONYMOUS_RECENT_COMMENTS_SECONDS = 60;

@Injectable()
export class HomeService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repository: HomeRepository,
    private readonly recentComments: RecentCommentsService,
    private readonly leaderboards: LeaderboardsRepository,
    private readonly languages: LanguagesQuerier,
  ) {}

  async home(principal: Principal | null): Promise<HomeResponse> {
    const [recentComments, problems, topPerformers, topContributors, counts] =
      await Promise.all([
        this.recent(principal),
        this.repository.newProblems(HOME_NEW_PROBLEMS),
        this.top('performancePoints'),
        this.top('contributionPoints'),
        this.repository.counts(),
      ]);
    return {
      recentComments,
      newProblems: problems.map((problem) => ({
        code: problem.code,
        name: problem.name,
        points: problem.points,
        date: problem.date,
      })),
      topPerformers,
      topContributors,
      counts: { ...counts, languages: this.languages.all().length },
    };
  }

  /** Signed-in viewers are never served the shared slice. Dates of a cached slice come back as ISO strings, which the JSON response serializes the same way. */
  private async recent(
    principal: Principal | null,
  ): Promise<RecentCommentResponse[]> {
    const newest = async () =>
      (
        await this.recentComments.newest(principal, {
          limit: RECENT_COMMENTS_COUNT,
        })
      ).items;
    if (principal || officialContestLocks(this.env.officialContestMode, null))
      return newest();
    const cached = await this.redis.get(ANONYMOUS_RECENT_COMMENTS_KEY);
    if (cached !== null) return JSON.parse(cached) as RecentCommentResponse[];
    const items = await newest();
    await this.redis.set(
      ANONYMOUS_RECENT_COMMENTS_KEY,
      JSON.stringify(items),
      'EX',
      ANONYMOUS_RECENT_COMMENTS_SECONDS,
    );
    return items;
  }

  /** Legacy `get_top_pp_users`/`get_top_contributors`: listed users above 0, through the leaderboard index. */
  private async top(
    field: Extract<
      LeaderboardField,
      'performancePoints' | 'contributionPoints'
    >,
  ): Promise<HomeUserResponse[]> {
    return (await this.leaderboards.page(field, 1, HOME_TOP_USERS))
      .filter((user) => user[field] > 0)
      .map((user) => ({
        username: user.username,
        displayRank: user.displayRank,
        rating: user.rating,
        performancePoints: user.performancePoints,
        contributionPoints: user.contributionPoints,
      }));
  }
}
