import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';

/**
 * The contest fields a participation's results depend on: the worker's scoring read projects exactly these, and an
 * edit that changes one (as `scoringKeyOf` compares it) queues a rescore. A new top-level field joins both; a problem
 * sub-field the worker starts scoring on must also join `SCORING_PARTS.problems`.
 */
export const SCORING_CONTEST_FIELDS = [
  'formatName',
  'formatConfig',
  'startTime',
  'endTime',
  'timeLimit',
  'frozenLastMinutes',
  'pointsPrecision',
  'problems',
] as const;
export type ScoringContestField = (typeof SCORING_CONTEST_FIELDS)[number];
export type ScoringKeyInput = Pick<Contest, ScoringContestField>;

/** Fields of which only a part scores: whether a time limit is set (it moves a live row's start between the contest start and its join), and each problem's id, points, partial and order. */
const SCORING_PARTS: Partial<
  Record<ScoringContestField, (contest: ScoringKeyInput) => unknown>
> = {
  timeLimit: (contest) => contest.timeLimit === null,
  problems: (contest) =>
    contest.problems.map((entry) => [
      uuidStr(entry.problem),
      entry.points,
      entry.partial,
      entry.order,
    ]),
};

/** The scoring fields as an edit compares them: the same key means the same results. */
export const scoringKeyOf = (contest: ScoringKeyInput): string =>
  JSON.stringify(
    SCORING_CONTEST_FIELDS.map((field) =>
      SCORING_PARTS[field] ? SCORING_PARTS[field](contest) : contest[field],
    ),
  );
