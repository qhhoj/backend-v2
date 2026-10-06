import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, runCoalesced } from '@libs/common';
import { acceptanceRate, userPoints } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionEffectsRepository } from './submission-effects.repository';

/** The only place a user's points or a problem's stats are recomputed (graded jobs, the sweep, rescores). Each recompute reads Mongo and `$set`s, serialised per key across processes. */
@Injectable()
export class SubmissionEffectsService {
  constructor(
    private readonly repository: SubmissionEffectsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `on_grading_end`: the user only when the problem counts for points, then the problem's stats. A deleted problem has nothing to update. */
  async apply(job: SubmissionGradedJob): Promise<void> {
    const problem = await this.repository.findProblem(job.problemId);
    if (!problem) return;
    if (problem.isPublic && !problem.isOrganizationPrivate)
      await this.recomputeUser(job.userId);
    await this.recomputeProblem(job.problemId);
    // Hooks: organisation points (sub-project 5) and contest results (sub-project 4).
  }

  recomputeUser(userId: string): Promise<void> {
    return runCoalesced(this.redis, `effects:user:${userId}`, async () =>
      this.repository.setUserPoints(
        userId,
        userPoints(await this.repository.problemBests(userId)),
      ),
    );
  }

  recomputeProblem(problemId: string): Promise<void> {
    return runCoalesced(
      this.redis,
      `effects:problem:${problemId}`,
      async () => {
        const problem = await this.repository.findProblem(problemId);
        if (!problem) return;
        const counts = await this.repository.problemCounts(
          problemId,
          problem.points,
        );
        await this.repository.setProblemStats(problemId, {
          userCount: counts.userCount,
          acRate: acceptanceRate(counts.accepted, counts.total),
        });
      },
    );
  }
}
