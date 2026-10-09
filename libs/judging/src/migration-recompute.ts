/** After a migrator backfill: every derived value recomputed by its one writer, and every rated contest re-rated (D3 of the migrator plan). */
export const MIGRATION_RECOMPUTE_QUEUE = 'migration-recompute';
export const MIGRATION_RECOMPUTE_JOB = 'recompute';
/** One run at a time; a finished run is replaced by the next request. */
export const MIGRATION_RECOMPUTE_JOB_ID = 'migration-recompute';

export interface RatingReplayResult {
  /** Contests the replay rated. */
  ratedContests: number;
  /** Rating rows it wrote. */
  ratings: number;
  /** Rated, ended contests left out because their board is still frozen. */
  frozenRatedContests: number;
}

export interface MigrationRecomputeResult extends RatingReplayResult {
  participations: number;
  problems: number;
  users: number;
  contributors: number;
  organizations: number;
  contests: number;
}
