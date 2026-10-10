/** Legacy tables not migrated by decision (plan coverage table, decisions.md); `verify` lists them so a missing collection is never mistaken for a lost one. */
export const SKIPPED_TABLES: readonly { table: string; reason: string }[] = [
  { table: 'judge_judge', reason: 'judge-v2 registers judges fresh' },
  { table: 'judge_judge_problems', reason: 'judge-v2 registers judges fresh' },
  { table: 'judge_judge_runtimes', reason: 'judge-v2 registers judges fresh' },
  {
    table: 'judge_blogpost',
    reason: 'legacy blog unused; its comments are skipped',
  },
  {
    table: 'judge_blogpost_authors',
    reason: 'legacy blog unused; its comments are skipped',
  },
  {
    table: 'judge_blogvote',
    reason: 'legacy blog unused; its comments are skipped',
  },
  { table: 'judge_badge', reason: 'badges dropped' },
  { table: 'judge_profile_badges', reason: 'badges dropped' },
  {
    table: 'judge_rating',
    reason: 're-rated by the migration-recompute rating replay',
  },
  { table: 'judge_useractivity', reason: 'unbounded log, v2 keeps 90 days' },
  { table: 'judge_usersession', reason: 'sessions invalidated at cutover' },
  { table: 'django_session', reason: 'sessions invalidated at cutover' },
  {
    table: 'reversion_revision',
    reason: 'audit history stays in the archived dump',
  },
  {
    table: 'reversion_version',
    reason: 'audit history stays in the archived dump',
  },
  {
    table: 'django_admin_log',
    reason: 'audit history stays in the archived dump',
  },
  {
    table: 'impersonate_impersonationlog',
    reason: 'audit history stays in the archived dump',
  },
  { table: 'judge_contestmoss', reason: 'MOSS dropped' },
  { table: 'judge_problemclarification', reason: 'clarifications dropped' },
  { table: 'judge_externaljudgeconfig', reason: 'no v2 feature' },
  { table: 'judge_externalproblem', reason: 'no v2 feature' },
  { table: 'judge_externalsubmission', reason: 'no v2 feature' },
  { table: 'judge_url', reason: 'waits for v2 shortLinks (B8)' },
  { table: 'django_redirect', reason: 'framework bookkeeping' },
];

export const skippedLines = (): string[] =>
  SKIPPED_TABLES.map(
    ({ table, reason }) => `skipped by decision: ${table} (${reason})`,
  );
