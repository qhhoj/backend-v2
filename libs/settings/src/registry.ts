import {
  booleanType,
  integerType,
  mailFromType,
  oauthClientType,
  optionalUrlType,
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
  /** How a PATCH combines with the stored value; absent: the patch replaces it. Method syntax keeps definitions assignable to `SettingDefinition<unknown>`. */
  combine?(current: Value, patch: unknown): unknown;
}

const define = <Value>(definition: SettingDefinition<Value>) => definition;

/** Object settings with a fixed shape: the given fields replace theirs, the rest (a secret the UI cannot show) is kept. */
const mergeFields = <Value extends object>(current: Value, patch: unknown) =>
  typeof patch === 'object' && patch !== null && !Array.isArray(patch)
    ? { ...current, ...patch }
    : patch;

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
      'Official contest mode: non-superusers cannot edit their about or first name, read or write comments, vote on comments or write blog posts.',
    secret: false,
  }),
  'contest.banAfterDisqualifications': define({
    type: integerType(0, 1000),
    default: 0,
    description:
      'Disqualifications (in contests that are not organization-private) that ban an account; 0 turns the ban off.',
    secret: false,
  }),
  'discord.webhooks': define({
    type: webhooksType,
    default: {},
    description:
      'Discord webhook URLs by event (default, on_new_comment, on_new_blogpost, on_new_problem, on_new_suggested_problem, on_new_ticket, on_new_ticket_message); empty disables them.',
    secret: true,
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
