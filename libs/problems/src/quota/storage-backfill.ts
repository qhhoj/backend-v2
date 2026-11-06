/** The `migrations` id of the size backfill (`problems.dataBytes`, `pdfStatementBytes`, `materialBytes` measured from disk): `quota.enforce = enforce` is honoured only once it is recorded, so a half-measured site never blocks anyone (decisions.md: quota rolls out warn-only). */
export const STORAGE_BACKFILL_MIGRATION = '2026-10-12-problem-databytes';
/** The Redis flag releases before the `migrations` row read instead; the backfill still sets it and `isEnforcing` still accepts it, so a rolled-back release and a host whose deploy helper has no migrate step keep `enforce`. */
export const LEGACY_STORAGE_BACKFILL_KEY = 'quota:databytes-backfilled';
