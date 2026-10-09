const DAY_MS = 86_400_000;

/** Whole days (rounded up) before the purge job may take a problem deleted at `deletedAt`; 0 once the grace period is over. */
export function daysLeft(
  deletedAt: Date,
  graceDays: number,
  now: Date,
): number {
  const remaining = deletedAt.getTime() + graceDays * DAY_MS - now.getTime();
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}
