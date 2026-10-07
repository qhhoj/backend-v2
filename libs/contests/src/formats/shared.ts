import { pythonRound } from '@libs/judging';
import { FormatConfigError } from './format';
import type {
  FormatConfig,
  ParticipationScore,
  ProblemCell,
  ScoringRow,
} from './format';

export const secondsSince = (start: Date, date: Date): number =>
  (date.getTime() - start.getTime()) / 1000;

/** Legacy `round(score, points_precision)`. */
export const roundScore = (score: number, precision: number): number =>
  pythonRound(score, precision);

const byDateThenId = (left: ScoringRow, right: ScoringRow): number =>
  left.date.getTime() - right.date.getTime() ||
  (left.submissionId < right.submissionId
    ? -1
    : left.submissionId > right.submissionId
      ? 1
      : 0);

/** Rows per problem, each list oldest first (ids break equal dates). */
export function rowsByProblem(
  rows: readonly ScoringRow[],
): Map<string, ScoringRow[]> {
  const groups = new Map<string, ScoringRow[]>();
  for (const scored of [...rows].sort(byDateThenId)) {
    const group = groups.get(scored.problemId) ?? [];
    group.push(scored);
    groups.set(scored.problemId, group);
  }
  return groups;
}

/** Legacy `MAX(points)` and the earliest submission reaching it (`MIN(date) WHERE points = MAX`). `rows` are oldest first. */
export function bestOf(rows: readonly ScoringRow[]): {
  points: number;
  date: Date;
} {
  const points = Math.max(...rows.map((scored) => scored.points));
  return {
    points,
    date: rows.find((scored) => scored.points === points)!.date,
  };
}

/** Legacy tries exclude IE, CE and rows without a result. */
export const isTry = (scored: ScoringRow): boolean =>
  scored.result !== null && scored.result !== 'IE' && scored.result !== 'CE';

/** Formats without a freeze: the frozen fields mirror the live ones. */
export const unfrozen = (live: {
  score: number;
  cumtime: number;
  tiebreaker: number;
  formatData: Record<string, ProblemCell>;
}): ParticipationScore => ({
  ...live,
  frozenScore: live.score,
  frozenCumtime: live.cumtime,
  frozenTiebreaker: live.tiebreaker,
  frozenFormatData: live.formatData,
});

/** Legacy `validate`: null, or an object of known keys whose values have the default's type and pass `isValid`. */
export function parseKnownConfig<Config extends FormatConfig>(
  raw: unknown,
  defaults: Config,
  isValid: Partial<
    Record<keyof Config, (value: number | boolean) => boolean>
  > = {},
): Config {
  if (raw === null || raw === undefined) return { ...defaults };
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new FormatConfigError('expects no config or an object');
  const config: FormatConfig = { ...defaults };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in defaults))
      throw new FormatConfigError(`unknown config key "${key}"`);
    if (typeof value !== typeof defaults[key])
      throw new FormatConfigError(`invalid type for config key "${key}"`);
    const check = isValid[key as keyof Config];
    if (check && !check(value as number | boolean))
      throw new FormatConfigError(
        `invalid value ${String(value)} for config key "${key}"`,
      );
    config[key] = value as number | boolean;
  }
  return config as Config;
}

/** Formats without options accept nothing but an empty config. */
export function rejectConfig(raw: unknown): Record<string, never> {
  if (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Object.keys(raw).length === 0)
  )
    return {};
  throw new FormatConfigError('expects no config');
}
