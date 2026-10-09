import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_QUEUE,
  contestSubmissionPoints,
  enqueueContestRating,
  notifyReplayBuild,
  replayDelayMs,
} from '@libs/contests';
import type { ContestRatingJob, ContestReplayJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ScoringContest } from '../submission-effects/contest-results.repository';
import { ContestResultsRepository } from '../submission-effects/contest-results.repository';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';
import { ContestRescoreRepository } from './contest-rescore.repository';

/** Participations recomputed at once. */
const PARTICIPATION_PARALLELISM = 8;

@Injectable()
export class ContestRescoreService {
  private readonly logger = new Logger(ContestRescoreService.name);

  constructor(
    private readonly repository: ContestRescoreRepository,
    private readonly contestResults: ContestResultsRepository,
    private readonly effects: SubmissionEffectsService,
    @InjectQueue(CONTEST_RATING_QUEUE)
    private readonly ratingQueue: Queue<ContestRatingJob>,
    @InjectQueue(CONTEST_REPLAY_QUEUE)
    private readonly replayQueue: Queue<ContestReplayJob>,
  ) {}

  /** Legacy `rescore_contest` plus the per-submission `update_contest` it relied on: every contest submission's points from its case totals and the contest's current problems, then every participation through the coalesced recompute. Rows of problems no longer in the contest keep their points. A contest that has ratings is re-rated afterwards (disqualifications and scoring edits change the standings the ratings came from); an enqueue failure fails the run, and the retry rescores again. Last, the contest's replay is rebuilt: a request that cannot be queued never fails the run. */
  async rescore(
    contestId: string,
  ): Promise<{ rescored: number; participations: number }> {
    const contest = await this.contestResults.findContest(contestId);
    if (!contest) return { rescored: 0, participations: 0 };
    const rescored = await this.rescoreSubmissions(contestId, contest);
    const participations = await this.recomputeParticipations(contestId);
    // Keyed on stored ratings, not `isRated`: a contest no longer rated but still holding ratings loses them here.
    if (await this.repository.hasRatings(contestId))
      await enqueueContestRating(this.ratingQueue, contestId);
    // Waits for the judge to settle after the end: a build that starts earlier is a no-op (no head is written before then).
    // Derived, repairable data: a lost request is repaired by the next replay read or by the editor's button.
    await notifyReplayBuild(this.replayQueue, contestId, this.logger, {
      delayMs: replayDelayMs(contest.endTime, new Date()),
    });
    return { rescored, participations };
  }

  /** Points of every contest submission of the contest's current problems, written only where they changed. */
  private async rescoreSubmissions(
    contestId: string,
    contest: ScoringContest,
  ): Promise<number> {
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
    return rescored;
  }

  /** Every participation of the contest through the coalesced recompute, a parallel batch at a time. */
  private async recomputeParticipations(contestId: string): Promise<number> {
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
    return participations;
  }
}
