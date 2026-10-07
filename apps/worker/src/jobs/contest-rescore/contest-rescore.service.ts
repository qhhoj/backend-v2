import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CONTEST_RATING_QUEUE,
  contestSubmissionPoints,
  enqueueContestRating,
} from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { ContestResultsRepository } from '../submission-effects/contest-results.repository';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';
import { ContestRescoreRepository } from './contest-rescore.repository';

/** Participations recomputed at once. */
const PARTICIPATION_PARALLELISM = 8;

@Injectable()
export class ContestRescoreService {
  constructor(
    private readonly repository: ContestRescoreRepository,
    private readonly contestResults: ContestResultsRepository,
    private readonly effects: SubmissionEffectsService,
    @InjectQueue(CONTEST_RATING_QUEUE)
    private readonly ratingQueue: Queue<ContestRatingJob>,
  ) {}

  /** Legacy `rescore_contest` plus the per-submission `update_contest` it relied on: every contest submission's points from its case totals and the contest's current problems, then every participation through the coalesced recompute. Rows of problems no longer in the contest keep their points. A contest that has ratings is re-rated afterwards (disqualifications and scoring edits change the standings the ratings came from); an enqueue failure fails the run, and the retry rescores again. */
  async rescore(
    contestId: string,
  ): Promise<{ rescored: number; participations: number }> {
    const contest = await this.contestResults.findContest(contestId);
    if (!contest) return { rescored: 0, participations: 0 };
    const entries = new Map(
      contest.problems.map((entry) => [uuidStr(entry.problem), entry]),
    );
    const partials = await this.contestResults.problemPartials([
      ...entries.keys(),
    ]);
    let rescored = 0;
    for await (const chunk of this.repository.submissionChunks(contestId)) {
      const totals = await this.contestResults.caseTotals(
        chunk.map((row) => uuidStr(row._id)),
      );
      const changes = chunk.flatMap((row) => {
        const id = uuidStr(row._id);
        const problemId = uuidStr(row.problem);
        const entry = entries.get(problemId);
        const caseTotals = totals.get(id);
        if (!entry || !caseTotals) return [];
        const points = contestSubmissionPoints(
          caseTotals,
          entry,
          contest.formatName,
          partials.get(problemId) ?? false,
        );
        return points === row.points
          ? []
          : [{ id, previous: row.points, points }];
      });
      rescored += await this.repository.setPoints(changes);
    }
    let participations = 0;
    for await (const chunk of this.repository.participationChunks(contestId)) {
      participations += chunk.length;
      for (
        let start = 0;
        start < chunk.length;
        start += PARTICIPATION_PARALLELISM
      )
        await Promise.all(
          chunk
            .slice(start, start + PARTICIPATION_PARALLELISM)
            .map((id) => this.effects.recomputeParticipation(id)),
        );
    }
    // Keyed on stored ratings, not `isRated`: a contest no longer rated but still holding ratings loses them here.
    if (await this.repository.hasRatings(contestId))
      await enqueueContestRating(this.ratingQueue, contestId);
    return { rescored, participations };
  }
}
