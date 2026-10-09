import type { Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ContestScope } from '../../problems/core/problem-access';

export interface ProblemLimits {
  /** Seconds. */
  timeLimit: number;
  /** KiB, the judge's unit. */
  memoryLimit: number;
}

/** Limits of the problems the viewer may see; the others are absent from the map (and read as null). */
export function visibleLimits(
  principal: Principal | null,
  problems: readonly Problem[],
  scope: ContestScope | null,
): Map<string, ProblemLimits> {
  return new Map(
    problems
      .filter((problem) =>
        ProblemAccess.canSee(
          principal,
          ProblemAccess.accessView(problem),
          scope,
        ),
      )
      .map((problem) => [
        uuidStr(problem._id),
        { timeLimit: problem.timeLimit, memoryLimit: problem.memoryLimit },
      ]),
  );
}
