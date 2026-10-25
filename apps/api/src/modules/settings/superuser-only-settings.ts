import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import type { SettingKey } from '@libs/settings';

/** Credentials, and where the server sends data or contestants' code (external judge, Discord, Polygon, whose account setters share problems with). */
const OFF_SITE_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'mail.smtpUrl',
  'externalJudge.baseUrl',
  'externalJudge.apiToken',
  'discord.webhooks',
  'polygon.apiKey',
  'polygon.apiSecret',
  'polygon.accountName',
]);

/** Decision 416: `judge.change_settings` is operator-grade, but these keys hold credentials, sign-in, the role every organization admin gets and where the server sends data, so only a superuser may read or change them. */
export const isSuperuserOnly = (key: SettingKey): boolean =>
  OFF_SITE_KEYS.has(key) ||
  key === 'organization.adminRoleId' ||
  key.startsWith('auth.');

export const isSettingVisibleTo = (key: SettingKey, actor: Principal) =>
  actor.isSuperuser || !isSuperuserOnly(key);

/** 403 issue `superuser_only` on `key` when `actor` may not read or change `key`. */
export function assertSettingAccess(key: SettingKey, actor: Principal): void {
  if (isSettingVisibleTo(key, actor)) return;
  const message = 'Only a superuser may read or change this setting';
  throw new AppError('forbidden', 403, message, undefined, undefined, {
    issues: [{ field: 'key', code: 'superuser_only', message }],
  });
}
