import type Redis from 'ioredis';
import type { ParticipationScore, ProblemCell } from './formats/format';

/** A participation's result fields as stored (the schema keeps cells untyped), so a participation document fits without a cast. */
export interface ParticipationResults {
  score: number;
  cumtime: number;
  tiebreaker: number;
  frozenScore: number;
  frozenCumtime: number;
  frozenTiebreaker: number;
  /** Lean reads of contests migrated from legacy may lack the cells; missing is `{}`. */
  formatData?: Record<string, unknown>;
  frozenFormatData?: Record<string, unknown>;
  isDisqualified: boolean;
}

/** What a ranking row shows: either every live field or every frozen one, never a mix. */
export interface Standing {
  score: number;
  cumtime: number;
  tiebreaker: number;
  isDisqualified: boolean;
  cells: Record<string, ProblemCell>;
}

type RankedFields = Pick<
  Standing,
  'isDisqualified' | 'score' | 'cumtime' | 'tiebreaker'
>;

export const DISQUALIFIED_SCORE = -9999;

export const standingOf = (
  results: ParticipationResults,
  isFrozenView: boolean,
): Standing =>
  isFrozenView
    ? {
        score: results.frozenScore,
        cumtime: results.frozenCumtime,
        tiebreaker: results.frozenTiebreaker,
        isDisqualified: results.isDisqualified,
        cells: (results.frozenFormatData ?? {}) as Record<string, ProblemCell>,
      }
    : {
        score: results.score,
        cumtime: results.cumtime,
        tiebreaker: results.tiebreaker,
        isDisqualified: results.isDisqualified,
        cells: (results.formatData ?? {}) as Record<string, ProblemCell>,
      };

/** Legacy `order_by('is_disqualified', '-score', 'cumtime', 'tiebreaker')`. */
export const compareStandings = (
  left: RankedFields,
  right: RankedFields,
): number =>
  Number(left.isDisqualified) - Number(right.isDisqualified) ||
  right.score - left.score ||
  left.cumtime - right.cumtime ||
  left.tiebreaker - right.tiebreaker;

/** Legacy `ranker` over sorted rows: equal (score, cumtime, tiebreaker) share a rank, the next rank skips (1, 1, 3). */
export function competitionRanks(sorted: readonly RankedFields[]): number[] {
  const ranks: number[] = [];
  sorted.forEach((row, index) => {
    const previous = sorted[index - 1];
    const tied =
      previous !== undefined &&
      previous.score === row.score &&
      previous.cumtime === row.cumtime &&
      previous.tiebreaker === row.tiebreaker;
    ranks.push(tied ? ranks[index - 1] : index + 1);
  });
  return ranks;
}

/** Legacy `recompute_results` for a disqualified row, applied to the frozen fields too so a frozen board never shows its score. */
export const disqualify = (score: ParticipationScore): ParticipationScore => ({
  ...score,
  score: DISQUALIFIED_SCORE,
  cumtime: 0,
  tiebreaker: 0,
  frozenScore: DISQUALIFIED_SCORE,
  frozenCumtime: 0,
  frozenTiebreaker: 0,
});

/** The api reads, the worker purges: one key per {with virtual rows, frozen}. */
export const rankingCacheKey = (
  contestId: string,
  withVirtual: boolean,
  frozen: boolean,
): string =>
  `contest-ranking:${contestId}:${withVirtual ? 'all' : 'live'}:${frozen ? 'frozen' : 'open'}`;

export const rankingCacheKeys = (contestId: string): string[] =>
  [false, true].flatMap((withVirtual) =>
    [false, true].map((frozen) =>
      rankingCacheKey(contestId, withVirtual, frozen),
    ),
  );

/** The api caches per-problem solver counts per frozen view (`SolverCountsService`); the recomputes that drop the boards drop them too. */
export const solverCountsCacheKey = (
  contestId: string,
  isFrozenView: boolean,
): string => `contest-solvers:${contestId}:${isFrozenView ? 'frozen' : 'open'}`;

/** Every recompute of a contest's participation drops all four boards, the frozen ones included (legacy left those stale), and both solver-count keys. */
export const purgeRankingCache = (
  redis: Redis,
  contestId: string,
): Promise<number> =>
  redis.del(
    ...rankingCacheKeys(contestId),
    solverCountsCacheKey(contestId, false),
    solverCountsCacheKey(contestId, true),
  );
