import type { Principal } from '@libs/auth';
import { contestPhase } from '@libs/contests';
import { ContestAccess } from '../core/contest-access';
import type { ContestDocument } from '../core/contests.repository';
import { replayRefusal } from './replay-refusal';

export function assertEnded(contest: ContestDocument, now: Date): void {
  if (contestPhase(contest, now) !== 'ended')
    throw replayRefusal(
      409,
      'contest_not_ended',
      'Wait until the contest has ended',
    );
}

/** The refusal of a board the viewer may not read: hidden, or visible but frozen for them. */
const boardRefusal = (
  principal: Principal | null,
  contest: ContestDocument,
  now: Date,
) => {
  const isVisible = ContestAccess.boardVisible(
    principal,
    ContestAccess.accessView(contest),
    now,
  );
  return replayRefusal(
    403,
    'forbidden',
    isVisible
      ? 'The ranking of this contest is frozen'
      : 'The ranking of this contest is hidden',
    isVisible ? 'board_frozen' : 'board_hidden',
  );
};

/** The replay is the board over time: the board visible as for the ranking AND not frozen for this viewer (`boardReadable`; a freeze outlives the end), never `canSeeFullScoreboard`, which has no freeze check. It also waits for the end and has no final-submission form. Order: 403, 409, 409. */
export function assertReplayReadable(
  principal: Principal | null,
  contest: ContestDocument,
  now: Date,
): void {
  if (
    !ContestAccess.boardReadable(
      principal,
      ContestAccess.accessView(contest),
      now,
    )
  )
    throw boardRefusal(principal, contest, now);
  assertEnded(contest, now);
  if (contest.formatName === 'final_submission')
    throw replayRefusal(
      409,
      'replay_unsupported',
      'No replay for this contest format',
    );
}
