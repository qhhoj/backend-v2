import {
  booleanType,
  integerType,
  mailFromType,
  oauthClientType,
  oneOfType,
  optionalDatetimeType,
  optionalServiceUrlType,
  optionalTextType,
  optionalUrlType,
  optionalUuidType,
  smtpUrlType,
  timeZoneType,
  webhooksType,
} from './setting-types';
import type { OAuthClientSetting, SettingType } from './setting-types';

export interface SettingDefinition<Value> {
  type: SettingType<Value>;
  default: Value;
  description: string;
  /** `true`: the whole value is encrypted at rest; a list: those top-level fields of an object value are. */
  secret: boolean | readonly string[];
  /** The value was stored unsealed before it became a whole-value secret: a stored string that does not open is that plain value (the next write seals it), and old revision rows are redacted when read. */
  storedPlainBefore?: true;
  /** How a PATCH combines with the stored value; absent: the patch replaces it. Method syntax keeps definitions assignable to `SettingDefinition<unknown>`. */
  combine?(current: Value, patch: unknown): unknown;
}

const define = <Value>(definition: SettingDefinition<Value>) => definition;

/** Object settings with a fixed shape: the given fields replace theirs, the rest (a secret the UI cannot show) is kept. */
const mergeFields = <Value extends object>(current: Value, patch: unknown) =>
  typeof patch === 'object' && patch !== null && !Array.isArray(patch)
    ? { ...current, ...patch }
    : patch;

/** The events sent replace theirs and a null removes one; the others (secret, so the UI cannot resend them) are kept. */
const mergeWebhooks = (current: Record<string, string>, patch: unknown) => {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
    return patch;
  const merged: Record<string, unknown> = { ...current, ...patch };
  return Object.fromEntries(
    Object.entries(merged).filter(([, url]) => url !== null),
  );
};

const disabledClient: OAuthClientSetting = {
  enabled: false,
  clientId: '',
  clientSecret: '',
};
const socialLogin = (provider: string) =>
  define({
    type: oauthClientType,
    default: disabledClient,
    description: `${provider} social login: enabled flag, OAuth client id and secret.`,
    secret: ['clientSecret'],
    combine: mergeFields,
  });

/** The single place to add a setting: key, type, default, secret flag, description. Readers call `SettingsService.get(key)`. */
export const SETTINGS = {
  'site.timeZone': define({
    type: timeZoneType,
    default: 'Asia/Ho_Chi_Minh',
    description:
      'Time zone of the site: "today" in the statistics strip starts at its midnight.',
    secret: false,
  }),
  'contest.officialMode': define({
    type: booleanType,
    default: false,
    description:
      'Official contest mode: non-superusers cannot edit their about, first name, display badge or organization order, read or write comments, vote on comments, write blog posts, or join, leave or request to join organizations; tickets stay open. Switches itself off at contest.officialModeEndsAt.',
    secret: false,
  }),
  'contest.officialModeEndsAt': define({
    type: optionalDatetimeType,
    default: '',
    description:
      'Official contest mode switches itself off from this instant (ISO 8601 with an offset); empty: only the flag decides. Forgetting to switch the mode off then cannot lock the site.',
    secret: false,
  }),
  'contest.banAfterDisqualifications': define({
    type: integerType(0, 1000),
    default: 0,
    description:
      'Disqualifications (in contests that are not organization-private) that ban an account; 0 turns the ban off.',
    secret: false,
  }),
  'quota.enforce': define({
    type: oneOfType(['warn', 'enforce'] as const),
    default: 'warn',
    description:
      'Organization quota: warn only logs and shows overages; enforce refuses them. Enforce takes effect only after the problem data size backfill has finished.',
    secret: false,
  }),
  'quota.defaultMonthlyCredits': define({
    type: integerType(0, 1_000_000),
    default: 200,
    description: 'Monthly credits of an organization with no staff-set limit.',
    secret: false,
  }),
  'quota.defaultStorageBytes': define({
    type: integerType(0, 1_099_511_627_776),
    default: 536_870_912,
    description:
      'Test-data bytes an organization may keep when it has no staff-set limit (default 512 MiB).',
    secret: false,
  }),
  'quota.cost.problem': define({
    type: integerType(0, 1000),
    default: 10,
    description: 'Credits to create or clone an organization problem.',
    secret: false,
  }),
  'quota.cost.contest': define({
    type: integerType(0, 1000),
    default: 20,
    description: 'Credits to create or clone an organization contest.',
    secret: false,
  }),
  'quota.cost.dataPer10MiB': define({
    type: integerType(0, 1000),
    default: 1,
    description: 'Credits per 10 MiB (started) of an uploaded data archive.',
    secret: false,
  }),
  'organization.adminRoleId': define({
    type: optionalUuidType,
    default: '',
    description:
      'Id of the role every organization admin is given on becoming one (never taken away); empty: the role named "Org Admin".',
    secret: false,
  }),
  'problem.deleteGraceDays': define({
    type: integerType(1, 365),
    default: 30,
    description:
      'Days a deleted problem can be restored; after that its data is purged and only a tombstone (code and name) stays. Submissions are never deleted.',
    secret: false,
  }),
  'discord.webhooks': define({
    type: webhooksType,
    default: {},
    description:
      'Discord webhook URLs by event (default, on_new_comment, on_new_blogpost, on_new_problem, on_new_suggested_problem, on_new_ticket, on_new_ticket_message); empty disables them.',
    secret: true,
    combine: mergeWebhooks,
  }),
  'mail.from': define({
    type: mailFromType,
    default: 'QHHOJ <no-reply@qhhoj.local>',
    description: 'From address of outgoing mail.',
    secret: false,
  }),
  'mail.smtpUrl': define({
    type: smtpUrlType,
    default: '',
    description:
      'SMTP server URL (smtp:// or smtps://, credentials percent-encoded); empty: mail is not configured.',
    secret: true,
  }),
  'auth.pwnedApiUrl': define({
    type: optionalUrlType,
    default: 'https://api.pwnedpasswords.com',
    description:
      'Have I Been Pwned range API base URL; empty turns the breach check off.',
    secret: false,
  }),
  'auth.google': socialLogin('Google'),
  'auth.github': socialLogin('GitHub'),
  'auth.facebook': socialLogin('Facebook'),
  'polygon.apiKey': define({
    type: optionalTextType(100),
    default: '',
    description:
      'API key of the Polygon account QHHOJ imports problems with (Polygon, Settings, API keys); empty: Polygon is not connected (zip import still works).',
    secret: true,
    storedPlainBefore: true,
  }),
  'polygon.apiSecret': define({
    type: optionalTextType(100),
    default: '',
    description: 'API secret paired with polygon.apiKey.',
    secret: true,
  }),
  'polygon.accountName': define({
    type: optionalTextType(100),
    default: '',
    description:
      'Polygon login of that account; setters add it as a READ co-author of their problem.',
    secret: false,
  }),
  'externalJudge.baseUrl': define({
    type: optionalServiceUrlType,
    default: '',
    description:
      'Base URL of the PCD VJudge API that judges external (mirror) problems on remote OJs; empty: external judging is off.',
    secret: false,
  }),
  'externalJudge.apiToken': define({
    type: optionalTextType(500),
    default: '',
    description:
      'Bearer token for externalJudge.baseUrl; empty: external judging is off.',
    secret: true,
  }),
  'externalJudge.maxInFlight': define({
    type: integerType(1, 50),
    default: 5,
    description:
      'External submissions waiting on the remote OJ at once; the rest stay queued (also bounds a batch rejudge).',
    secret: false,
  }),
  'externalJudge.maxWaitMinutes': define({
    type: integerType(1, 240),
    default: 30,
    description:
      'An external submission with no final result this long after it was sent ends as an internal error.',
    secret: false,
  }),
  'pdf.renderTimeoutMs': define({
    type: integerType(100, 600_000),
    default: 30_000,
    description:
      'A single PDF render (page load and printing) is aborted after this long.',
    secret: false,
  }),
  'pdf.maxBytes': define({
    type: integerType(1, 1_073_741_824),
    default: 52_428_800,
    description: 'A rendered PDF larger than this is discarded.',
    secret: false,
  }),
  'similarity.minPercent': define({
    type: integerType(1, 100),
    default: 50,
    description:
      'Code similarity runs store pairs at or above this percentage.',
    secret: false,
  }),
  'similarity.maxPairs': define({
    type: integerType(1, 20_000),
    default: 2000,
    description:
      'Code similarity runs keep at most this many pairs, most similar first.',
    secret: false,
  }),
  'similarity.maxSubmissions': define({
    type: integerType(2, 10_000),
    default: 3000,
    description:
      'Code similarity compares at most this many (the newest) submissions per problem and language family.',
    secret: false,
  }),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<Key extends SettingKey> =
  (typeof SETTINGS)[Key] extends SettingDefinition<infer Value> ? Value : never;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const definitionOf = (key: string): SettingDefinition<unknown> | null =>
  Object.hasOwn(SETTINGS, key) ? SETTINGS[key as SettingKey] : null;
