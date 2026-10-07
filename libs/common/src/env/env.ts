import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface Env {
  mongoUrl: string;
  redisUrl: string;
  encryptionKey: string;
  tokenSecret: string;
  siteUrl: string;
  port: number;
  logLevel: string;
  /** false, or a comma-separated list of proxy addresses (IPs/CIDRs/`loopback`) whose forwarding headers are trusted. */
  trustProxy: false | string;
  cookieSecure: boolean;
  /** null disables the Have I Been Pwned check. */
  pwnedApiUrl: string | null;
  smtpUrl: string;
  mailFrom: string;
  /** Directory of uploaded files (images, PDF statements, materials); nginx serves it at `mediaUrl`. */
  mediaRoot: string;
  /** Public URL prefix of `mediaRoot`, without a trailing slash. */
  mediaUrl: string;
  /** Shared judge volume: `<root>/<code>/` holds init.yml, the archive and checker/grader sources. */
  problemDataRoot: string;
  /** Rendered statement PDFs, `<root>/<code>.<lang>.pdf`; shared between api and worker. */
  pdfCacheRoot: string;
  /** Worker: a single PDF render (page load and printing) is aborted after this long. */
  pdfRenderTimeoutMs: number;
  /** Worker: a rendered PDF larger than this is discarded. */
  pdfMaxBytes: number;
  /** Worker: PDF renders running at once. */
  pdfConcurrency: number;
  /** Disqualifications (in contests that are not organisation-private) that ban an account; 0 turns the ban off. */
  contestBanAfterDisqualifications: number;
  /** Bridge: judges connect to this TCP port (DMOJ judge protocol); 0 picks a free port (tests). */
  judgeBridgePort: number;
  /** Bridge: interface the judge port listens on. */
  judgeBridgeHost: string;
  /** Worker: MOSS user id; null disables MOSS (routes 404). Never logged. */
  mossApiKey: string | null;
  /** Contest data zips, shared by the api (serves) and the worker (writes); null disables data download. Not under MEDIA_ROOT (served publicly). */
  contestDataRoot: string | null;
  /** A provider is null (login disabled) unless both its client id and secret are set. */
  oauth: {
    google: OAuthClient | null;
    facebook: OAuthClient | null;
    github: OAuthClient | null;
  };
}

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

export const ENV = Symbol('ENV');

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const problems: string[] = [];
  const required = (name: string) =>
    source[name] || (problems.push(`${name} is required`), '');
  const flag = (name: string, fallback: boolean) => {
    const value = source[name];
    if (value === undefined) return fallback;
    if (value !== 'true' && value !== 'false')
      problems.push(`${name} must be true or false`);
    return value === 'true';
  };
  const proxies = (name: string): false | string => {
    const value = source[name];
    if (value === undefined || value === 'false') return false;
    if (value === 'true' || /^\s*\d*\s*$/.test(value)) {
      problems.push(
        `${name} must be false or a comma-separated list of proxy addresses`,
      );
      return false;
    }
    return value;
  };
  const oauthClient = (name: string): OAuthClient | null => {
    const clientId = source[`${name}_CLIENT_ID`];
    const clientSecret = source[`${name}_CLIENT_SECRET`];
    if (!clientId !== !clientSecret)
      problems.push(`${name} requires both CLIENT_ID and CLIENT_SECRET`);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  };
  const positiveInteger = (name: string, fallback: number): number => {
    const value = Number(source[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1)
      problems.push(`${name} must be a positive integer`);
    return value;
  };
  const nonNegativeInteger = (name: string, fallback: number): number => {
    const value = Number(source[name] ?? fallback);
    if (!Number.isInteger(value) || value < 0)
      problems.push(`${name} must be a non-negative integer`);
    return value;
  };
  /** Blank counts as unset; `min` 0 allows "any free port". */
  const portNumber = (name: string, fallback: number, min: number): number => {
    const raw = source[name]?.trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < min || value > 65535)
      problems.push(`${name} must be ${min}-65535`);
    return value;
  };
  const env: Env = {
    mongoUrl: required('MONGO_URL'),
    redisUrl: required('REDIS_URL'),
    encryptionKey: source.ENCRYPTION_KEY ?? '',
    tokenSecret: source.TOKEN_SECRET ?? '',
    siteUrl: required('SITE_URL'),
    port: portNumber('PORT', 3000, 1),
    logLevel: source.LOG_LEVEL ?? 'info',
    trustProxy: proxies('TRUST_PROXY'),
    cookieSecure: flag('COOKIE_SECURE', true),
    pwnedApiUrl:
      source.PWNED_API_URL === undefined
        ? 'https://api.pwnedpasswords.com'
        : source.PWNED_API_URL || null,
    smtpUrl: required('SMTP_URL'),
    mailFrom: source.MAIL_FROM || 'QHHOJ <no-reply@qhhoj.local>',
    mediaRoot: required('MEDIA_ROOT'),
    mediaUrl: (source.MEDIA_URL || '/media').replace(/\/+$/, ''),
    problemDataRoot: required('PROBLEM_DATA_ROOT'),
    pdfCacheRoot: required('PDF_CACHE_ROOT'),
    pdfRenderTimeoutMs: positiveInteger('PDF_RENDER_TIMEOUT_MS', 30_000),
    pdfMaxBytes: positiveInteger('PDF_MAX_BYTES', 52_428_800),
    pdfConcurrency: positiveInteger('PDF_CONCURRENCY', 2),
    contestBanAfterDisqualifications: nonNegativeInteger(
      'CONTEST_BAN_AFTER_DISQUALIFICATIONS',
      0,
    ),
    judgeBridgePort: portNumber('JUDGE_BRIDGE_PORT', 9999, 0),
    judgeBridgeHost: source.JUDGE_BRIDGE_HOST || '0.0.0.0',
    mossApiKey: source.MOSS_API_KEY || null,
    contestDataRoot: source.CONTEST_DATA_ROOT || null,
    oauth: {
      google: oauthClient('GOOGLE'),
      facebook: oauthClient('FACEBOOK'),
      github: oauthClient('GITHUB'),
    },
  };
  if (env.smtpUrl && !/^smtps?:\/\//.test(env.smtpUrl))
    problems.push('SMTP_URL must start with smtp:// or smtps://');
  if (!/^[0-9a-f]{64}$/i.test(env.encryptionKey))
    problems.push('ENCRYPTION_KEY must be 64 hex chars');
  if (env.tokenSecret.length < 32)
    problems.push('TOKEN_SECRET must be at least 32 chars');
  if (!LOG_LEVELS.includes(env.logLevel))
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join('|')}`);
  const inside = (child: string, parent: string) => {
    const relation = relative(resolve(parent), resolve(child));
    // `..cache` is a child; only a leading `..` segment leaves the parent.
    const [head] = relation.split(sep);
    return relation === '' || (head !== '..' && !isAbsolute(relation));
  };
  if (
    env.contestDataRoot &&
    env.mediaRoot &&
    inside(env.contestDataRoot, env.mediaRoot)
  )
    problems.push('CONTEST_DATA_ROOT must not be inside MEDIA_ROOT');
  if (problems.length)
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  return env;
}
