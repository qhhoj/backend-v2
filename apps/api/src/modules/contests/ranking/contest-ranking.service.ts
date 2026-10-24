import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Principal } from '@libs/auth';
import { constantTimeEqual, sha256 } from '@libs/auth';
import { AppError, RateLimitService, REDIS, unique } from '@libs/common';
import {
  compareStandings,
  competitionRanks,
  isFrozenFor,
  problemLabel,
  problemSummaries,
  rankingCacheKey,
  standingOf,
  type Standing,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestParticipation } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestAccess } from '../core/contest-access';
import { ContestViewerService } from '../core/contest-viewer.service';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import type { RankingResponse } from './dto/ranking.response';
import { ParticipationsRepository } from '../core/participations.repository';
import { RankingUsersRepository } from './ranking-users.repository';
import { RatingChangesRepository } from '../rating/rating-changes.repository';
import type { RatingChange } from '../rating/rating-changes.repository';
import {
  ACCESS_CODE_IP_LIMIT,
  ACCESS_CODE_WINDOW_SECONDS,
} from '../core/rate-limits';

export interface RankingRequest {
  withVirtual: boolean;
  /** The plaintext ranking access code and the caller's address (its wrong guesses are rate-limited). */
  rankingAccess?: { accessCode: string; ip: string };
  now?: Date;
}

export interface BoardView {
  withVirtual: boolean;
  /** Frozen standings only, never mixed with live ones. */
  isFrozenView: boolean;
  /** Never for editors: their board may differ from the shared one. */
  isCacheable: boolean;
}

interface RankedStanding {
  row: ContestParticipation;
  id: string;
  standing: Standing;
}

/** A shared board is cached at least this long, also with `scoreboardCacheTimeout` 0: a burst of requests (every contestant's poll, a reload loop) then builds it once. Recomputes purge it, so a new result shows at once. */
export const MIN_RANKING_CACHE_SECONDS = 5;

/** Each row's standing, sorted and ranked: ties share a rank, and equal standings fall back to participation id order. */
const rankedStandings = (
  rows: ContestParticipation[],
  isFrozenView: boolean,
): { standings: RankedStanding[]; ranks: number[] } => {
  const standings = rows
    .map((row) => ({
      row,
      id: uuidStr(row._id),
      standing: standingOf(row, isFrozenView),
    }))
    .sort(
      (left, right) =>
        compareStandings(left.standing, right.standing) ||
        left.id.localeCompare(right.id),
    );
  const ranks = competitionRanks(standings.map(({ standing }) => standing));
  return { standings, ranks };
};

/** Legacy `ContestRanking`, as JSON (the frontend renders cells from `formatData`). */
@Injectable()
export class ContestRankingService {
  private readonly builds = new Map<string, Promise<RankingResponse>>();

  constructor(
    private readonly contestsService: ContestsService,
    private readonly viewers: ContestViewerService,
    private readonly participations: ParticipationsRepository,
    private readonly rankingUsers: RankingUsersRepository,
    private readonly ratingChanges: RatingChangesRepository,
    private readonly problems: ProblemsRepository,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rateLimit: RateLimitService,
  ) {}

  async ranking(
    principal: Principal | null,
    key: string,
    { withVirtual, rankingAccess, now = new Date() }: RankingRequest,
  ): Promise<RankingResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const accessView = ContestAccess.accessView(contest);
    const canEdit = ContestAccess.canEdit(principal, accessView);
    // Non-editors only ever see frozen standings during a freeze, their own row included.
    const isFrozenView = isFrozenFor(contest, now, canEdit);
    const boardView: BoardView = {
      withVirtual,
      isFrozenView,
      isCacheable: !canEdit,
    };
    if (rankingAccess) {
      await this.assertRankingCode(contest, rankingAccess);
      return this.board(contest, boardView);
    }
    const viewer = await this.viewers.viewerOf(principal, contest, now);
    if (!ContestAccess.canSeeOwnScoreboard(principal, accessView, now, viewer))
      throw new AppError(
        'forbidden',
        403,
        'The ranking of this contest is hidden',
      );
    if (!ContestAccess.canSeeFullScoreboard(principal, accessView, now, viewer))
      return this.buildBoard(
        contest,
        viewer.live ? [viewer.live.toObject()] : [],
        { isFrozenView, isRanked: false },
      );
    return this.board(contest, boardView);
  }

  /**
   * Every row, ranked: cached under `rankingCacheKey` for `scoreboardCacheTimeout` seconds, at least `MIN_RANKING_CACHE_SECONDS`, when `isCacheable` (never for editors).
   * The public link and the ranking code read the same keys: a non-editor's board does not depend on who asks.
   */
  async board(
    contest: ContestDocument,
    boardView: BoardView,
  ): Promise<RankingResponse> {
    const { withVirtual, isFrozenView, isCacheable } = boardView;
    if (!isCacheable)
      return this.buildBoard(
        contest,
        await this.participations.rankingRows(contest._id, { withVirtual }),
        { isFrozenView, isRanked: true },
      );
    const cacheKey = rankingCacheKey(contest._id, withVirtual, isFrozenView);
    const inFlight = this.builds.get(cacheKey);
    if (inFlight) return inFlight;
    const pendingBoard = this.cachedBoard(contest, cacheKey, boardView).finally(
      () => this.builds.delete(cacheKey),
    );
    this.builds.set(cacheKey, pendingBoard);
    return pendingBoard;
  }

  /** Redis hit, or one build and write; concurrent misses on a key share this call (`builds`). */
  private async cachedBoard(
    contest: ContestDocument,
    cacheKey: string,
    { withVirtual, isFrozenView }: BoardView,
  ): Promise<RankingResponse> {
    const hit = await this.redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as RankingResponse;
    const ranking = await this.buildBoard(
      contest,
      await this.participations.rankingRows(contest._id, { withVirtual }),
      { isFrozenView, isRanked: true },
    );
    await this.redis.set(
      cacheKey,
      JSON.stringify(ranking),
      'EX',
      Math.max(contest.scoreboardCacheTimeout, MIN_RANKING_CACHE_SECONDS),
    );
    return ranking;
  }

  /** Legacy `ContestPublicRanking`: a plaintext code compared in constant time against the stored hash; wrong codes spend the IP's budget. */
  private async assertRankingCode(
    contest: ContestDocument,
    { accessCode, ip }: { accessCode: string; ip: string },
  ): Promise<void> {
    const release = await this.rateLimit.reserve(
      [`ranking-code:ip:${ip}`],
      ACCESS_CODE_IP_LIMIT,
      ACCESS_CODE_WINDOW_SECONDS,
    );
    if (
      contest.rankingAccessCodeHash === null ||
      !constantTimeEqual(sha256(accessCode), contest.rankingAccessCodeHash)
    )
      throw new AppError('forbidden', 403, 'Wrong ranking code');
    await release();
  }

  /**
   * Every row's standing (frozen or live, never mixed), sorted and ranked in memory.
   * Legacy's fifth sort key (`-submission_count`) is dropped: it needs a count per participation over the submissions
   * and only reorders rows that already share a rank, so those fall back to participation id order, stable across requests.
   */
  private async buildBoard(
    contest: ContestDocument,
    rows: ContestParticipation[],
    { isFrozenView, isRanked }: { isFrozenView: boolean; isRanked: boolean },
  ): Promise<RankingResponse> {
    const { standings, ranks } = rankedStandings(rows, isFrozenView);
    const users = await this.rankingUsers.rankingUsersOf(
      unique(rows.map((row) => uuidStr(row.user))),
    );
    const problems = await this.problemColumns(contest, standings);
    // Ratings are applied only to an unfrozen board; a frozen view never hints at the hidden result.
    const ratingChanges =
      isFrozenView || !contest.isRated
        ? new Map<string, RatingChange>()
        : await this.ratingChanges.ofContest(uuidStr(contest._id));
    return {
      frozen: isFrozenView,
      problems,
      rows: standings.map(({ row, id, standing }, index) => {
        const userId = uuidStr(row.user);
        return {
          rank: isRanked ? ranks[index] : null,
          participationId: id,
          user: {
            id: userId,
            username: users.get(userId)?.username ?? '',
            rating: users.get(userId)?.rating ?? null,
            organization: users.get(userId)?.organization ?? null,
          },
          virtual: row.virtual,
          ...standing,
          ratingChange: ratingChanges.get(id) ?? null,
        };
      }),
    };
  }

  /** The contest's problem columns in order, with their codes and per-problem summaries over the standings. */
  private async problemColumns(
    contest: ContestDocument,
    standings: RankedStanding[],
  ): Promise<RankingResponse['problems']> {
    const ordered = [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
    const codes = new Map(
      (
        await this.problems.findSummaries(
          ordered.map((entry) => uuidStr(entry.problem)),
        )
      ).map((problem) => [problem._id, problem.code]),
    );
    const summaries = problemSummaries(
      { name: contest.formatName, config: contest.formatConfig },
      ordered.map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      })),
      standings.map(({ row, id, standing }) => ({
        participationId: id,
        virtual: row.virtual,
        cells: standing.cells,
      })),
    );
    return ordered.map((entry, index) => {
      const problemId = uuidStr(entry.problem);
      return {
        problemId,
        code: codes.get(problemId) ?? '',
        label: problemLabel(index, contest.labelStyle),
        points: entry.points,
        ...summaries.get(problemId)!,
      };
    });
  }
}
