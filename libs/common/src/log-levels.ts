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
const SEVERITY = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/** Apps without pino (worker, bridge): `LOG_LEVEL` selects which Nest logger levels are printed. */
export function nestLogLevels(logLevel: string): LogLevel[] {
  const enabledUpTo = SEVERITY.indexOf(logLevel);
  return NEST_LEVELS.filter(
    ([, threshold]) => SEVERITY.indexOf(threshold) <= enabledUpTo,
  ).map(([level]) => level);
}
