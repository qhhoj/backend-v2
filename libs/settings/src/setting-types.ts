import { canonicalTimeZone, MAIL_ADDRESS_PATTERN } from '@libs/common';
import { isUuid } from '@libs/database';
import { BlockList, isIP } from 'node:net';

/** A rejected value; the message is safe to show an admin and never contains the value. */
export class SettingError extends Error {}

export interface SettingType<Value> {
  parse(raw: unknown): Value;
}

const fail = (message: string): never => {
  throw new SettingError(message);
};
export const isPlainObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

export const booleanType: SettingType<boolean> = {
  parse: (raw) =>
    typeof raw === 'boolean' ? raw : fail('Must be true or false.'),
};

export const integerType = (min: number, max: number): SettingType<number> => ({
  parse: (raw) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max
      ? raw
      : fail(`Must be an integer from ${min} to ${max}.`),
});

/** One of a fixed list of strings (modes, policies). */
export const oneOfType = <Value extends string>(
  values: readonly Value[],
): SettingType<Value> => ({
  parse: (raw) =>
    values.includes(raw as Value)
      ? (raw as Value)
      : fail(`Must be one of: ${values.join(', ')}.`),
});

/**
 * Addresses a production server must not be pointed at: loopback, private, link-local, unspecified
 * and IPv4-mapped IPv6. Two lists: a BlockList mixing families matches IPv4 against the IPv6 ranges.
 */
const internalIpv4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const)
  internalIpv4.addSubnet(network, prefix, 'ipv4');
const internalIpv6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
] as const)
  internalIpv6.addSubnet(network, prefix, 'ipv6');

/** Literal internal hosts only: a name that resolves to an internal address is not caught (accepted residual risk). */
const isInternalHost = (hostname: string): boolean => {
  const name = hostname.replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const address = hostname.replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) return internalIpv4.check(address, 'ipv4');
  return family === 6 && internalIpv6.check(address, 'ipv6');
};

/**
 * https anywhere; http only for this machine, and only outside production. In production the
 * URL must not name localhost or an internal literal address, so an admin-set URL cannot reach the
 * server's own network. The mode is read per call so a test or a restart sees the current value.
 */
export const isSafeUrl = (url: string): boolean => {
  if (url.length > 2048 || !URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  const production = process.env.NODE_ENV === 'production';
  if (protocol === 'https:') return !(production && isInternalHost(hostname));
  return (
    !production &&
    protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(hostname)
  );
};

/** An IANA zone name (`Asia/Ho_Chi_Minh`); offsets like `+07:00` are refused. */
export const timeZoneType: SettingType<string> = {
  parse: (raw) =>
    canonicalTimeZone(raw) !== null
      ? (raw as string)
      : fail('Must be an IANA time zone name.'),
};

const INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** `new Date` rolls `2026-02-31` over to March 3; a typo must not move the end silently. */
const isRealCalendarDay = (instant: string): boolean => {
  const [year, month, day] = instant.slice(0, 10).split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
};

/** `''` switches the feature off; otherwise an ISO 8601 instant that names its offset (a bare local time would mean different instants on different servers). Stored as UTC. */
export const optionalDatetimeType: SettingType<string> = {
  parse: (raw) => {
    if (raw === '') return '';
    const instant =
      typeof raw === 'string' && INSTANT_WITH_OFFSET.test(raw)
        ? new Date(raw)
        : null;
    return instant &&
      !Number.isNaN(instant.getTime()) &&
      isRealCalendarDay(raw as string)
      ? instant.toISOString()
      : fail(
          'Must be empty or an ISO 8601 instant with an offset, e.g. 2026-10-10T08:00:00+07:00.',
        );
  },
};

const hasControlCharacter = (text: string): boolean =>
  [...text].some((char) => char.charCodeAt(0) < 0x20 || char === '\u007f');

/** Short single-line text such as an API key; `''` means unset. No control characters, so the value cannot break a header or a log line. Surrounding spaces (a sloppy paste) are dropped. */
export const optionalTextType = (maxLength: number): SettingType<string> => ({
  parse: (raw) =>
    typeof raw === 'string' &&
    raw.length <= maxLength &&
    !hasControlCharacter(raw)
      ? raw.trim()
      : fail(`Must be text of at most ${maxLength} characters on one line.`),
});

/** `''` means unset; otherwise a record id such as a role's. Stored lower-case, as Mongo's UUIDs print. */
export const optionalUuidType: SettingType<string> = {
  parse: (raw) =>
    typeof raw === 'string' && (raw === '' || isUuid(raw))
      ? raw.toLowerCase()
      : fail(
          'Must be empty or an id like 01a12501-db2b-744c-bc51-4805439a680f.',
        ),
};

/** `''` switches the feature off. */
export const optionalUrlType: SettingType<string> = {
  parse: (raw) =>
    typeof raw === 'string' && (raw === '' || isSafeUrl(raw))
      ? raw
      : fail('Must be empty or an https URL.'),
};

/** `''` switches the feature off; otherwise an http(s) base URL without credentials, query or fragment. Plain http and private hosts are allowed: only settings admins set it, and a self-hosted service may have neither TLS nor a public address. */
export const optionalServiceUrlType: SettingType<string> = {
  parse: (raw) => {
    if (raw === '') return '';
    if (typeof raw !== 'string' || raw.length > 2048 || !URL.canParse(raw))
      return fail('Must be empty or an http(s) URL.');
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? raw.replace(/\/+$/, '')
      : fail(
          'Must be empty or an http(s) URL without credentials, query or fragment.',
        );
  },
};

/** The origin of a stored URL setting; null for an empty or unparsable one. */
export const originOf = (value: unknown): string | null =>
  typeof value === 'string' && URL.canParse(value)
    ? new URL(value).origin
    : null;

export const smtpUrlType: SettingType<string> = {
  parse: (raw) =>
    typeof raw === 'string' &&
    (raw === '' ||
      (raw.length <= 2048 &&
        /^smtps?:\/\/[^/\s]+/.test(raw) &&
        URL.canParse(raw)))
      ? raw
      : fail('Must be empty or an smtp:// or smtps:// URL.'),
};

/** A bare address or `Name <address>`; no CR/LF, so the value cannot inject a header. */
export const mailFromType: SettingType<string> = {
  parse: (raw) => {
    if (typeof raw !== 'string' || raw.length > 254)
      return fail('Must be an address or "Name <address>".');
    const named = /^[^<>"\r\n]{1,100} <([^<>\s]+)>$/.exec(raw);
    return MAIL_ADDRESS_PATTERN.test(named ? named[1] : raw)
      ? raw
      : fail('Must be an address or "Name <address>".');
  },
};

const WEBHOOK_EVENT = /^(default|on_[a-z_]+)$/;
const MAX_WEBHOOKS = 20;

/** Event name (`default` or `on_<event>`) to webhook URL. */
export const webhooksType: SettingType<Record<string, string>> = {
  parse: (raw) => {
    const entries = isPlainObject(raw) ? Object.entries(raw) : null;
    if (
      !entries ||
      entries.length > MAX_WEBHOOKS ||
      entries.some(
        ([event, url]) =>
          !WEBHOOK_EVENT.test(event) ||
          typeof url !== 'string' ||
          !isSafeUrl(url),
      )
    )
      return fail('Keys must be default or on_<event>, values https URLs.');
    return Object.fromEntries(entries) as Record<string, string>;
  },
};

export interface OAuthClientSetting {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

const OAUTH_FIELDS = ['enabled', 'clientId', 'clientSecret'];

export const oauthClientType: SettingType<OAuthClientSetting> = {
  parse: (raw) => {
    if (
      !isPlainObject(raw) ||
      Object.keys(raw).some((field) => !OAUTH_FIELDS.includes(field))
    )
      return fail('Must be {enabled, clientId, clientSecret}.');
    const { enabled, clientId, clientSecret } = raw;
    if (
      typeof enabled !== 'boolean' ||
      typeof clientId !== 'string' ||
      typeof clientSecret !== 'string' ||
      clientId.length > 256 ||
      clientSecret.length > 512
    )
      return fail('Must be {enabled, clientId, clientSecret}.');
    if (enabled && (!clientId || !clientSecret))
      return fail('An enabled provider needs a client id and a client secret.');
    return { enabled, clientId, clientSecret };
  },
};
