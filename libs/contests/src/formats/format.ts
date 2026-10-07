import type {
  ContestFormatName,
  SubmissionResult,
  SubmissionStatus,
} from '@libs/database';

export type FormatName = ContestFormatName;

/** One contest submission of the participation, as every format reads it. */
export interface ScoringRow {
  submissionId: string;
  /** The contest problem's problem id; cells are keyed by it. */
  problemId: string;
  date: Date;
  /** `contestSubmissions.points`. */
  points: number;
  result: SubmissionResult | null;
  status: SubmissionStatus;
  /** ioi16 only: per batch (`'0'` = cases outside batches) the smallest case points; null otherwise. */
  batchPoints: Record<string, number> | null;
}

export interface ScoringProblem {
  problemId: string;
  /** The contest problem's points. */
  points: number;
  /** ioi16 only: the problem data's plain-case and batch points (legacy `points_scaling_factor` divisor); null otherwise. */
  dataPoints: number | null;
}

export interface ScoringContext {
  /** `participationStart`. */
  start: Date;
  /** `ultimate` times from the contest start (legacy). */
  contestStart: Date;
  /** `frozenTime(contest)`: null when the board never freezes. */
  frozenTime: Date | null;
  pointsPrecision: number;
  problems: readonly ScoringProblem[];
}

/** One problem of one participation; the frontend renders it. */
export type ProblemCell = Record<string, number | boolean | null>;

export interface ParticipationScore {
  score: number;
  cumtime: number;
  tiebreaker: number;
  frozenScore: number;
  frozenCumtime: number;
  frozenTiebreaker: number;
  formatData: Record<string, ProblemCell>;
  /** What a frozen board shows; equals the live cells for formats without a freeze. */
  frozenFormatData: Record<string, ProblemCell>;
}

export type FormatConfig = Record<string, number | boolean>;

/** Method syntax on purpose: a format with a narrower config still fits the registry's `ContestFormat`. */
export interface ContestFormat<Config extends FormatConfig = FormatConfig> {
  /** Legacy `validate` plus `config_defaults`; throws `FormatConfigError`. */
  parseConfig(raw: unknown): Config;
  score(
    rows: readonly ScoringRow[],
    config: Config,
    context: ScoringContext,
  ): ParticipationScore;
  /** The cell's time for first solves; null when the format shows no solve times. */
  firstSolveTime(cell: ProblemCell, config: Config): number | null;
}

export class FormatConfigError extends Error {}
