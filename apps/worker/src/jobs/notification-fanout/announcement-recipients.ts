import { LIVE, participationEnd, SPECTATE } from '@libs/contests';
import type { ContestTimes, ParticipationTimes } from '@libs/contests';

/** Live participants (registered or joined) and virtual runs that are still running; never spectators or finished virtual runs. */
export function receivesAnnouncement(
  contest: ContestTimes,
  participation: ParticipationTimes,
  now: Date,
): boolean {
  if (participation.virtual === SPECTATE) return false;
  if (participation.virtual === LIVE) return true;
  return participationEnd(contest, participation) > now;
}
