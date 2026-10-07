import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import {
  compareStandings,
  MEAN_INIT,
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

/** Legacy `Contest.rate` + `rate_contest`. The only writer of `ratings` and `users.rating`. */
@Injectable()
export class ContestRatingService {
  constructor(private readonly repository: ContestRatingRepository) {}

  /**
   * Deletes the ratings from the target's end on, re-rates every rated contest from there in end order and refreshes `users.rating`, in one transaction: a failure leaves the previous ratings.
   * The run starts at the earlier of the target's end and its stored ratings' end, so an edited end time (moved either way) never loses ratings or leaves the contests between its old and new positions stale.
   * Cost: each affected user's history is read once and extended in memory, so a run is linear in the ratings written. Production (16 rated contests, 461 ratings) takes about 1 s, far inside Mongo's 60 s transaction limit.
   */
  rateFrom(
    contestId: string,
    now = new Date(),
  ): Promise<{ contests: number; ratings: number }> {
    return this.repository.inTransaction(async (session) => {
      const target = await this.repository.findContest(contestId, session);
      if (!target) return { contests: 0, ratings: 0 };
      const storedEnd = await this.repository.earliestRatingEnd(
        contestId,
        session,
      );
      const start =
        storedEnd && storedEnd < target.endTime ? storedEnd : target.endTime;
      if (start > now) return { contests: 0, ratings: 0 };
      const contests = await this.repository.ratedContestsFrom(
        start,
        now,
        session,
      );
      const touched = new Set(
        await this.repository.deleteFrom(
          start,
          [target._id, ...contests.map((contest) => contest._id)],
          session,
        ),
      );
      const histories = new Map<string, RatingHistory>();
      let ratings = 0;
      for (const contest of contests) {
        const rows = await this.rateContest(contest, now, histories, session);
        rows.forEach((row) => touched.add(row.user));
        ratings += rows.length;
      }
      await this.repository.refreshUserRatings([...touched], session);
      return { contests: contests.length, ratings };
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
