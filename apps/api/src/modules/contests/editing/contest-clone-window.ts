import type { Contest } from '@libs/database';

type ContestWindow = Pick<
  Contest,
  'startTime' | 'endTime' | 'registrationStart' | 'registrationEnd'
>;

const shifted = (time: Date | null, deltaMs: number): Date | null =>
  time && new Date(time.getTime() + deltaMs);

/** A clone's times: every time of the source moved by one amount, so the copy starts at `newStart` with the same length and registration window. */
export function shiftedWindow(
  source: ContestWindow,
  newStart: Date,
): ContestWindow {
  const deltaMs = newStart.getTime() - source.startTime.getTime();
  return {
    startTime: newStart,
    endTime: new Date(source.endTime.getTime() + deltaMs),
    registrationStart: shifted(source.registrationStart, deltaMs),
    registrationEnd: shifted(source.registrationEnd, deltaMs),
  };
}
