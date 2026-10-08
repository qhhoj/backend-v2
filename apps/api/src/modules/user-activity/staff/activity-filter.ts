import { escapeRegExp } from '@libs/common';
import type { UserActivity } from '@libs/database';
import type { FilterQuery } from 'mongoose';

export type ActivityScope =
  { kind: 'any' } | { kind: 'anonymous' } | { kind: 'users'; ids: string[] };

/** Rows of the last `days`; `ip` is a prefix (served by `{ip, at}`), `path` a case-insensitive fragment (bounded by the time window). Both are matched literally. */
export function activityFilter(
  {
    days,
    scope,
    ip,
    path,
  }: { days: number; scope: ActivityScope; ip?: string; path?: string },
  now = new Date(),
): FilterQuery<UserActivity> {
  const filter: FilterQuery<UserActivity> = {
    at: { $gte: new Date(now.getTime() - days * 86_400_000) },
  };
  if (scope.kind === 'anonymous') filter.userId = null;
  if (scope.kind === 'users') filter.userId = { $in: scope.ids };
  if (ip) filter.ip = new RegExp(`^${escapeRegExp(ip)}`);
  if (path) filter.path = new RegExp(escapeRegExp(path), 'i');
  return filter;
}
