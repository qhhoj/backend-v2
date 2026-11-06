import { Injectable } from '@nestjs/common';
import { InjectJob } from '@libs/common';
import type { JobProducer } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { submissionPoints } from '@libs/judging';
import { SubmissionEffectsRepository } from '../submission-effects/submission-effects.repository';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';
import { ProblemRescoreRepository } from './problem-rescore.repository';
import type { RescoredRow } from './problem-rescore.repository';
import { ID_CHUNK } from '@libs/common';

/** Users recomputed at once after a rescore. */
const USER_RECOMPUTE_PARALLELISM = 8;

@Injectable()
export class ProblemRescoreService {
  constructor(
    private readonly repository: ProblemRescoreRepository,
    private readonly effectsRepository: SubmissionEffectsRepository,
    private readonly effects: SubmissionEffectsService,
    @InjectJob(contestJobs.rescore)
    private readonly contestRescores: JobProducer<ContestRescoreJob>,
  ) {}

  /** Legacy `rescore_problem` with the rounding of `submissionPoints`: each graded submission's points from its case totals and the problem's current points and partial flag, written in chunks; then every user with a graded submission (their points also follow the problem's publicity) and the problem's stats. A second run writes nothing. */
  async rescore(
    problemId: string,
  ): Promise<{ rescored: number; users: number }> {
    const problem = await this.effectsRepository.findProblem(problemId);
    // A deleted problem's points no longer count anywhere; the delete's solvers recompute moves its users.
    if (!problem || problem.deletedAt) return { rescored: 0, users: 0 };
    const userIds = new Set<string>();
    let pending: RescoredRow[] = [];
    let rescored = 0;
    for await (const row of this.repository.gradedRows(problemId)) {
      userIds.add(uuidStr(row.user));
      const points = submissionPoints(
        row.casePoints,
        row.caseTotal,
        problem.points,
        problem.partial,
      );
      if (points !== row.points)
        pending.push({
          id: uuidStr(row._id),
          casePoints: row.casePoints,
          caseTotal: row.caseTotal,
          points,
        });
      if (pending.length === ID_CHUNK) {
        rescored += await this.repository.setPoints(pending);
        pending = [];
      }
    }
    rescored += await this.repository.setPoints(pending);
    const users = [...userIds];
    for (
      let start = 0;
      start < users.length;
      start += USER_RECOMPUTE_PARALLELISM
    )
      await Promise.all(
        users
          .slice(start, start + USER_RECOMPUTE_PARALLELISM)
          .map((userId) => this.effects.recomputeUser(userId)),
      );
    await this.effects.recomputeProblem(problemId);
    // Legacy `rescore_problem` called `update_contest` per submission: contest points follow the problem's partial flag.
    for (const contestId of await this.repository.contestsListing(problemId))
      await this.contestRescores.add({ contestId });
    return { rescored, users: users.length };
  }
}
