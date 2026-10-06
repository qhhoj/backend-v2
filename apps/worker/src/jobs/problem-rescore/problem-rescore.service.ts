import { Injectable } from '@nestjs/common';
import { uuidStr } from '@libs/database';
import { submissionPoints } from '@libs/judging';
import { SubmissionEffectsRepository } from '../submission-effects/submission-effects.repository';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';
import {
  ProblemRescoreRepository,
  RESCORE_CHUNK,
} from './problem-rescore.repository';
import type { RescoredRow } from './problem-rescore.repository';

/** Users recomputed at once after a rescore. */
const USER_RECOMPUTE_PARALLELISM = 8;

@Injectable()
export class ProblemRescoreService {
  constructor(
    private readonly repository: ProblemRescoreRepository,
    private readonly effectsRepository: SubmissionEffectsRepository,
    private readonly effects: SubmissionEffectsService,
  ) {}

  /** Legacy `rescore_problem` with 2a's rounding (`submissionPoints`): each graded submission's points from its case totals and the problem's current points and partial flag, written in chunks; then every user with a graded submission (their points also follow the problem's publicity) and the problem's stats. A second run writes nothing. */
  async rescore(
    problemId: string,
  ): Promise<{ rescored: number; users: number }> {
    const problem = await this.effectsRepository.findProblem(problemId);
    if (!problem) return { rescored: 0, users: 0 };
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
      if (pending.length === RESCORE_CHUNK) {
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
    return { rescored, users: users.length };
  }
}
