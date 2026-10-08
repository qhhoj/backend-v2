import { canonicalTimeZone, MAIL_ADDRESS_PATTERN } from '@libs/common';
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

/** `''` switches the feature off. */
export const optionalUrlType: SettingType<string> = {
  parse: (raw) =>
    typeof raw === 'string' && (raw === '' || isSafeUrl(raw))
      ? raw
      : fail('Must be empty or an https URL.'),
};

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
