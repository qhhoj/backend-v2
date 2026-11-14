import { contestPhase } from '@libs/contests';
import { ContestAccess, NO_FACTS } from '../../contests/core/contest-access';
import type { ContestAccessView } from '../../contests/core/contest-access';

/**
 * A contest keeps the shares of its problems closed until it has ended and a signed-out visitor may read its whole
 * submission list (board shown, not frozen). Both checks on purpose: `showSubmissionList` opens the list while the
 * contest still runs, and an upcoming contest's testers must not leak its problems. Only the contest's own window
 * counts, never a virtual run.
 */
export const isContestOpenForShares = (
  contest: ContestAccessView,
  now: Date,
): boolean =>
  contestPhase(contest, now) === 'ended' &&
  ContestAccess.canSeeFullSubmissionList(null, contest, now, NO_FACTS);
