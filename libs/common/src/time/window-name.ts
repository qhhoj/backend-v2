import { DAY_S, HOUR_S, MINUTE_S } from './time-units';

const NAMED_WINDOWS: ReadonlyArray<[number, string]> = [
  [MINUTE_S, 'minute'],
  [HOUR_S, 'hour'],
  [DAY_S, 'day'],
];

/** The unit a rate-limit window is spoken in ("20 per minute"); any other length reads as seconds. */
export const windowName = (seconds: number): string =>
  NAMED_WINDOWS.find(([length]) => length === seconds)?.[1] ??
  `${seconds} seconds`;
