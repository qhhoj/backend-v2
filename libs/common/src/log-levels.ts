import type { LogLevel } from '@nestjs/common';

/** Nest levels from most to least severe, paired with the `LOG_LEVEL` (pino vocabulary) that first enables them. */
const NEST_LEVELS: Array<[LogLevel, string]> = [
  ['fatal', 'fatal'],
  ['error', 'error'],
  ['warn', 'warn'],
  ['log', 'info'],
  ['debug', 'debug'],
  ['verbose', 'trace'],
];
/** Every accepted `LOG_LEVEL` (pino vocabulary), most to least severe; `silent` prints nothing. */
export const PINO_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

/** Apps without pino (worker, bridge): `LOG_LEVEL` selects which Nest logger levels are printed. */
export function nestLogLevels(logLevel: string): LogLevel[] {
  if (logLevel === 'silent') return [];
  const enabledUpTo = PINO_LEVELS.indexOf(logLevel);
  return NEST_LEVELS.filter(
    ([, threshold]) => PINO_LEVELS.indexOf(threshold) <= enabledUpTo,
  ).map(([level]) => level);
}
