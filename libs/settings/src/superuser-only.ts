import { SETTING_KEYS } from './registry';
import type { SettingKey } from './registry';

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

/** Decision 416: `judge.change_settings` is operator-grade, but these keys hold credentials, sign-in, the role every organization admin gets and where the server sends data, so only a superuser may read or change them (and see their history). */
export const isSuperuserOnly = (key: SettingKey): boolean =>
  OFF_SITE_KEYS.has(key) ||
  key === 'organization.adminRoleId' ||
  key.startsWith('auth.');

export const SUPERUSER_ONLY_KEYS: readonly SettingKey[] =
  SETTING_KEYS.filter(isSuperuserOnly);
