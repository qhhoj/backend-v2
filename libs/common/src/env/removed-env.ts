/** Variables that became admin settings (`libs/settings/src/registry.ts`); still set in an environment they are ignored, and boot says so once. MOSS_API_KEY is not listed: the variable is gone with MOSS and a stale one is ignored without a warning. */
export const REMOVED_ENV = [
  'OFFICIAL_CONTEST_MODE',
  'CONTEST_BAN_AFTER_DISQUALIFICATIONS',
  'DISCORD_WEBHOOK_URLS',
  'MAIL_FROM',
  'SMTP_URL',
  'PWNED_API_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'FACEBOOK_CLIENT_ID',
  'FACEBOOK_CLIENT_SECRET',
  'PDF_RENDER_TIMEOUT_MS',
  'PDF_MAX_BYTES',
] as const;

export const removedEnvInUse = (
  source: Record<string, string | undefined> = process.env,
): string[] => REMOVED_ENV.filter((name) => source[name]);
