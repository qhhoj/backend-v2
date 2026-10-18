import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { ClientSession } from 'mongoose';
import { REDIS } from '@libs/common';
import {
  compareStandings,
  isFrozen,
  MEAN_INIT,
  purgeRankingCache,
  RATING_INIT,
  recalculateRatings,
  tieRanks,
} from '@libs/contests';
import type { Rating } from '@libs/database';
import { ContestRatingRepository } from './contest-rating.repository';
import type {
  RatableContest,
  RatingHistory,
} from './contest-rating.repository';

type RatingRow = Omit<Rating, '_id'>;
type RatingRun = { contests: number; ratings: number };

/** Legacy `Contest.rate` + `rate_contest`. The only writer of `ratings` and `users.rating`. */
@Injectable()
export class ContestRatingService {
  private readonly logger = new Logger(ContestRatingService.name);

  constructor(
    private readonly repository: ContestRatingRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Deletes the ratings from the target's end on, re-rates every rated contest from there in end order and refreshes `users.rating`, in one transaction: a failure leaves the previous ratings.
   * The run starts at the earlier of the target's end and its stored ratings' end, then moves earlier until no contest with a rating stored at or after the start ends before it, so a contest whose end was moved (either way) keeps its ratings even when its own job has not run yet. Contests between its old and new positions stay stale only until that job runs.
   * Cost: each affected user's history is read once and extended in memory, so a run is linear in the ratings written. Production (16 rated contests, 461 ratings) takes about 1 s, far inside Mongo's 60 s transaction limit.
   * After the commit, the cached boards of every contest whose ratings changed are purged: board rows carry each row's rating change.
   */
  async rateFrom(contestId: string, now = new Date()): Promise<RatingRun> {
    const { boards, ...run } = await this.rateInTransaction(contestId, now);
    await this.purgeBoards(boards);
    return run;
  }

  /** The ratings are committed by now: a Redis failure must not fail the job, the stale boards only live until `scoreboardCacheTimeout`. */
  private async purgeBoards(contestIds: string[]): Promise<void> {
    const purges = await Promise.allSettled(
      contestIds.map((contestId) => purgeRankingCache(this.redis, contestId)),
    );
    if (purges.some((purge) => purge.status === 'rejected'))
      this.logger.warn(
        'Ratings applied; board cache not purged, expires after scoreboardCacheTimeout',
      );
  }

  private rateInTransaction(
    contestId: string,
    now: Date,
  ): Promise<RatingRun & { boards: string[] }> {
    const none = { contests: 0, ratings: 0, boards: [] };
    return this.repository.inTransaction(async (session) => {
      const target = await this.repository.findContest(contestId, session);
      if (!target) return none;
      // Ratings are derived from the live standings: a frozen board must not reveal them.
      if (isFrozen(target, now)) {
        this.logger.warn(
          `Contest ${contestId} is still frozen: not rated until the freeze is set to 0`,
        );
        return none;
      }
      const storedEnd = await this.repository.earliestRatingEnd(
        contestId,
        session,
      );
      let start =
        storedEnd && storedEnd < target.endTime ? storedEnd : target.endTime;
      // A contest moved earlier whose own job has not run keeps ratings stored after `start`: include its new end too.
      for (
        let earlier = await this.repository.earliestMovedEarlierEnd(
          start,
          session,
        );
        earlier;
        earlier = await this.repository.earliestMovedEarlierEnd(start, session)
      )
        start = earlier;
      if (start > now) return none;
      const contests = await this.repository.ratedContestsFrom(
        start,
        now,
        session,
      );
      const rerated = [target._id, ...contests.map((contest) => contest._id)];
      const deleted = await this.repository.deleteFrom(start, rerated, session);
      // Contests that stopped being rated lose their ratings too: their boards are stale as well.
      const boards = [...new Set([...rerated, ...deleted.contests])];
      const touched = new Set(deleted.users);
      const histories = new Map<string, RatingHistory>();
      let ratings = 0;
      for (const contest of contests) {
        const rows = await this.rateContest(contest, now, histories, session);
        rows.forEach((row) => touched.add(row.user));
        ratings += rows.length;
      }
      await this.repository.refreshUserRatings([...touched], session);
      return { contests: contests.length, ratings, boards };
    });
  }

  private async rateContest(
    contest: RatableContest,
    now: Date,
    histories: Map<string, RatingHistory>,
    session: ClientSession,
  ): Promise<RatingRow[]> {
    const candidates = (
      await this.repository.candidates(contest._id, session)
    ).filter(
      (candidate) =>
        !contest.rateExclude.includes(candidate.userId) &&
        (contest.rateAll || candidate.submissions > 0),
    );
    await this.loadHistories(
      candidates.map((candidate) => candidate.userId),
      histories,
      session,
    );
    const lastRating = (userId: string) => histories.get(userId)!.lastRating;
    const rated = candidates
      .filter(
        (candidate) =>
          (contest.ratingFloor === null ||
            lastRating(candidate.userId) >= contest.ratingFloor) &&
          (contest.ratingCeiling === null ||
            lastRating(candidate.userId) <= contest.ratingCeiling),
      )
      .sort(
        (left, right) =>
          compareStandings(left, right) ||
          left.participationId.localeCompare(right.participationId),
      );
    const ranks = tieRanks(
      rated,
      (left, right) =>
        left.score === right.score &&
        left.cumtime === right.cumtime &&
        left.tiebreaker === right.tiebreaker,
    );
    const outputs = recalculateRatings(
      rated.map((candidate, index) => ({
        rank: ranks[index],
        mean: histories.get(candidate.userId)!.lastMean,
        history: histories.get(candidate.userId)!.performances,
      })),
    );
    const rows = rated.map((candidate, index) => ({
      user: candidate.userId,
      contest: contest._id,
      participation: candidate.participationId,
      contestEndTime: contest.endTime,
      rank: ranks[index],
      ...outputs[index],
      lastRated: now,
    }));
    await this.repository.insert(rows, session);
    for (const row of rows) {
      const history = histories.get(row.user)!;
      history.lastRating = row.rating;
      history.lastMean = row.mean;
      history.performances.unshift(row.performance);
    }
    return rows;
  }

  /** Reads each user's history once per run (after the deletes); users without a rating start from the initial values. */
  private async loadHistories(
    userIds: string[],
    histories: Map<string, RatingHistory>,
    session: ClientSession,
  ): Promise<void> {
    const missing = userIds.filter((userId) => !histories.has(userId));
    const stored = await this.repository.histories(missing, session);
    for (const userId of missing)
      histories.set(
        userId,
        stored.get(userId) ?? {
          lastRating: RATING_INIT,
          lastMean: MEAN_INIT,
          performances: [],
        },
      );
  }
}
