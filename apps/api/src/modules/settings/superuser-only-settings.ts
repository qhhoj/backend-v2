import type { Principal } from '@libs/auth';
import { issueError } from '@libs/common';
import { isSuperuserOnly } from '@libs/settings';
import type { SettingKey } from '@libs/settings';

export const isSettingVisibleTo = (key: SettingKey, actor: Principal) =>
  actor.isSuperuser || !isSuperuserOnly(key);

/** 403 issue `superuser_only` on `key` when `actor` may not read or change `key`. */
export function assertSettingAccess(key: SettingKey, actor: Principal): void {
  if (isSettingVisibleTo(key, actor)) return;
  const message = 'Only a superuser may read or change this setting';
  throw issueError('forbidden', 403, {
    field: 'key',
    code: 'superuser_only',
    message,
  });
}
