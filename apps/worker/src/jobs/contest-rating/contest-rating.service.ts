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
import type { RatableContest } from './contest-rating.repository';

type RatingRow = Omit<Rating, '_id'>;

/** Legacy `Contest.rate` + `rate_contest`. The only writer of `ratings` and `users.rating`. */
@Injectable()
export class ContestRatingService {
  constructor(private readonly repository: ContestRatingRepository) {}

  /** Deletes the ratings from the target's end on, re-rates every rated contest from there in end order and refreshes `users.rating`, in one transaction: a failure leaves the previous ratings. */
  rateFrom(
    contestId: string,
    now = new Date(),
  ): Promise<{ contests: number; ratings: number }> {
    return this.repository.inTransaction(async (session) => {
      const target = await this.repository.findContest(contestId, session);
      if (!target || target.endTime > now) return { contests: 0, ratings: 0 };
      const contests = await this.repository.ratedContestsFrom(
        target.endTime,
        now,
        session,
      );
      const touched = new Set(
        await this.repository.deleteFrom(
          target.endTime,
          [target._id, ...contests.map((contest) => contest._id)],
          session,
        ),
      );
      let ratings = 0;
      for (const contest of contests) {
        const rows = await this.rateContest(contest, now, session);
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
    session: ClientSession,
  ): Promise<RatingRow[]> {
    const candidates = (
      await this.repository.candidates(contest._id, session)
    ).filter(
      (candidate) =>
        !contest.rateExclude.includes(candidate.userId) &&
        (contest.rateAll || candidate.submissions > 0),
    );
    const histories = await this.repository.histories(
      candidates.map((candidate) => candidate.userId),
      session,
    );
    const lastRating = (userId: string) =>
      histories.get(userId)?.lastRating ?? RATING_INIT;
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
        mean: histories.get(candidate.userId)?.lastMean ?? MEAN_INIT,
        history: histories.get(candidate.userId)?.performances ?? [],
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
    return rows;
  }
}
