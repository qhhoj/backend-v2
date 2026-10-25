import type { ScoringContext, ScoringRow } from './format';

/** Participation start of every table. */
export const T0 = new Date('2026-01-01T00:00:00Z');
export const at = (minutes: number, seconds = 0): Date =>
  new Date(T0.getTime() + (minutes * 60 + seconds) * 1000);

let submissions = 0;
export const row = (
  problemId: string,
  minutes: number,
  points: number,
  extra: Partial<ScoringRow> = {},
): ScoringRow => ({
  submissionId: `s${String((submissions += 1)).padStart(4, '0')}`,
  problemId,
  date: at(minutes),
  points,
  result: points > 0 ? 'AC' : 'WA',
  status: 'D',
  batchPoints: null,
  isPretested: false,
  ...extra,
});

export const context = (
  extra: Partial<ScoringContext> = {},
): ScoringContext => ({
  start: T0,
  contestStart: T0,
  frozenTime: null,
  pointsPrecision: 3,
  problems: [],
  ...extra,
});
