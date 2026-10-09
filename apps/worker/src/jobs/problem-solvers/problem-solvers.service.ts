import { Injectable } from '@nestjs/common';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';
import { ProblemSolversRepository } from './problem-solvers.repository';

/** Users per slice of work; one slice is in flight at a time. */
const CHUNK = 500;
/** Recomputes running together inside a slice (each is coalesced per user by `recomputeUser`). */
const PARALLELISM = 8;

/** A deleted problem stops counting for points and a restored one counts again: the same recompute-from-scratch that every graded submission triggers, for everyone who has submitted to it. */
@Injectable()
export class ProblemSolversService {
  constructor(
    private readonly repository: ProblemSolversRepository,
    private readonly effects: SubmissionEffectsService,
  ) {}

  async recompute(problemId: string): Promise<number> {
    const users = await this.repository.userIds(problemId);
    for (let start = 0; start < users.length; start += CHUNK)
      await this.recomputeChunk(users.slice(start, start + CHUNK));
    return users.length;
  }

  private async recomputeChunk(users: readonly string[]): Promise<void> {
    for (let start = 0; start < users.length; start += PARALLELISM)
      await Promise.all(
        users
          .slice(start, start + PARALLELISM)
          .map((userId) => this.effects.recomputeUser(userId)),
      );
  }
}
