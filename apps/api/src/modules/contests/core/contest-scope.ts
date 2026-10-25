import { contestPhase } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import type { ContestScope } from '../../problems/core/problem-access';

/** What being inside a contest does to problem access: once it started every contest problem is visible, whatever its own publicity. The one rule behind `CurrentContestService.scopeFrom` and the problem limits. */
export function contestScopeOf(contest: Contest, now: Date): ContestScope {
  return {
    contestId: uuidStr(contest._id),
    started: contestPhase(contest, now) !== 'upcoming',
    problemIds: contest.problems.map((entry) => uuidStr(entry.problem)),
  };
}
