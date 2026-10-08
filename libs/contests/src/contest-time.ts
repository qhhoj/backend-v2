import type { ContestFormatName } from '@libs/database';

export const LIVE = 0;
export const SPECTATE = -1;
/** Legacy `Contest.is_frozen`: only these formats freeze their board. */
export const FREEZE_FORMATS: readonly ContestFormatName[] = ['icpc', 'vnoj'];

export interface ContestTimes {
  startTime: Date;
  endTime: Date;
  /** Seconds from joining; null: the whole window. */
  timeLimit: number | null;
  frozenLastMinutes: number;
  formatName: ContestFormatName;
}
export type FreezeTimes = Pick<
  ContestTimes,
  'endTime' | 'frozenLastMinutes' | 'formatName'
>;
export interface ParticipationTimes {
  realStart: Date;
  virtual: number;
  isRegistered: boolean;
}
export type ContestPhase = 'upcoming' | 'running' | 'ended';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const plus = (date: Date, milliseconds: number) =>
  new Date(date.getTime() + milliseconds);

/** Legacy `can_join` (start ≤ now) and `ended` (end < now). */
export const contestPhase = (
  contest: Pick<ContestTimes, 'startTime' | 'endTime'>,
  now: Date,
): ContestPhase =>
  now < contest.startTime
    ? 'upcoming'
    : now > contest.endTime
      ? 'ended'
      : 'running';

/** Legacy `ContestParticipation.start`: the contest start for live and spectating rows of a contest without a time limit and for a registration not joined yet (legacy's 1970 sentinel), else the join time. */
export const participationStart = (
  contest: ContestTimes,
  participation: ParticipationTimes,
): Date =>
  participation.isRegistered ||
  (contest.timeLimit === null && participation.virtual <= LIVE)
    ? contest.startTime
    : participation.realStart;

/** Legacy `ContestParticipation.end_time`. */
export function participationEnd(
  contest: ContestTimes,
  participation: ParticipationTimes,
): Date {
  if (participation.virtual === SPECTATE || participation.isRegistered)
    return contest.endTime;
  if (participation.virtual > LIVE)
    return plus(
      participation.realStart,
      contest.timeLimit !== null
        ? contest.timeLimit * SECOND_MS
        : contest.endTime.getTime() - contest.startTime.getTime(),
    );
  if (contest.timeLimit === null) return contest.endTime;
  const limited = plus(participation.realStart, contest.timeLimit * SECOND_MS);
  return limited < contest.endTime ? limited : contest.endTime;
}

export const hasParticipationEnded = (
  contest: ContestTimes,
  participation: ParticipationTimes,
  now: Date,
): boolean => participationEnd(contest, participation) < now;

/** Legacy `frozen_time`, absolute for every participation (virtual ones included); null when the board never freezes. */
export const frozenTime = (contest: FreezeTimes): Date | null =>
  FREEZE_FORMATS.includes(contest.formatName) && contest.frozenLastMinutes > 0
    ? plus(contest.endTime, -contest.frozenLastMinutes * MINUTE_MS)
    : null;

/** Legacy: stays frozen after the end until the freeze is set to 0. */
export const isFrozen = (contest: FreezeTimes, now: Date): boolean => {
  const from = frozenTime(contest);
  return from !== null && now >= from;
};

export interface RegistrationWindow {
  registrationStart: Date | null;
  registrationEnd: Date | null;
}

/** Legacy `require_registration`. */
export const requiresRegistration = (window: RegistrationWindow): boolean =>
  window.registrationStart !== null || window.registrationEnd !== null;

/** Legacy `can_register`: inside both bounds (inclusive). */
export const isRegistrationOpen = (
  window: RegistrationWindow,
  now: Date,
): boolean =>
  requiresRegistration(window) &&
  (window.registrationStart === null || now >= window.registrationStart) &&
  (window.registrationEnd === null || now <= window.registrationEnd);

export const LIVE_STATUSES = [
  'registered',
  'participating',
  'finished',
] as const;
/** Where the viewer's live participation stands: registered and not joined, inside its window, or past its end. */
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** A registration never joined ends with the contest, like legacy (it counts in `userCount` too). */
export function liveStatusOf(
  contest: ContestTimes,
  live: ParticipationTimes | null,
  now: Date,
): LiveStatus | null {
  if (live === null) return null;
  if (hasParticipationEnded(contest, live, now)) return 'finished';
  return live.isRegistered ? 'registered' : 'participating';
}
