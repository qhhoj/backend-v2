import { checkDataRoots } from './data-roots';

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
  /** Directory of uploaded files (images, PDF statements, materials); nginx serves it at `mediaUrl`. */
  mediaRoot: string;
  /** Public URL prefix of `mediaRoot`, without a trailing slash. */
  mediaUrl: string;
  /** Shared judge volume: `<root>/<code>/` holds init.yml, the archive and checker/grader sources. */
  problemDataRoot: string;
  /** Rendered statement PDFs, `<root>/<code>.<lang>.pdf`; shared between api and worker. */
  pdfCacheRoot: string;
  /** Worker: PDF renders running at once. */
  pdfConcurrency: number;
  /** Bridge: judges connect to this TCP port (DMOJ judge protocol); 0 picks a free port (tests). */
  judgeBridgePort: number;
  /** Bridge: interface the judge port listens on. */
  judgeBridgeHost: string;
  /** Contest data zips, shared by the api (serves) and the worker (writes); null disables data download. Not under MEDIA_ROOT (served publicly). */
  contestDataRoot: string | null;
  /** Exported user data zips, shared by the api (serves) and the worker (writes); null disables the export. Not under MEDIA_ROOT (served publicly). */
  userDataRoot: string | null;
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

/** Typed reads from `source` that collect every problem instead of throwing, so one boot reports them all. */
class EnvReader {
  readonly problems: string[] = [];

  constructor(private readonly source: Record<string, string | undefined>) {}

  /** The raw value, `fallback` only when unset (a blank stays blank). */
  textOr(name: string, fallback: string): string {
    return this.source[name] ?? fallback;
  }

  /** Blank counts as unset. */
  nonBlankOr<Fallback>(name: string, fallback: Fallback): string | Fallback {
    return this.source[name] || fallback;
  }

  required(name: string): string {
    return this.source[name] || (this.problems.push(`${name} is required`), '');
  }

  booleanFrom(name: string, fallback: boolean): boolean {
    const value = this.source[name];
    if (value === undefined) return fallback;
    if (value !== 'true' && value !== 'false')
      this.problems.push(`${name} must be true or false`);
    return value === 'true';
  }

  proxyList(name: string): false | string {
    const value = this.source[name];
    if (value === undefined || value === 'false') return false;
    if (value === 'true' || /^\s*\d*\s*$/.test(value)) {
      this.problems.push(
        `${name} must be false or a comma-separated list of proxy addresses`,
      );
      return false;
    }
    return value;
  }

  positiveInteger(name: string, fallback: number): number {
    const value = Number(this.source[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1)
      this.problems.push(`${name} must be a positive integer`);
    return value;
  }

  /** Blank counts as unset; `min` 0 allows "any free port". */
  portNumber(name: string, fallback: number, min: number): number {
    const raw = this.source[name]?.trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < min || value > 65535)
      this.problems.push(`${name} must be ${min}-65535`);
    return value;
  }
}

/** Every field, read in this order so problems are reported in it. */
function readEnv(reader: EnvReader): Env {
  return {
    mongoUrl: reader.required('MONGO_URL'),
    redisUrl: reader.required('REDIS_URL'),
    encryptionKey: reader.textOr('ENCRYPTION_KEY', ''),
    tokenSecret: reader.textOr('TOKEN_SECRET', ''),
    siteUrl: reader.required('SITE_URL'),
    port: reader.portNumber('PORT', 3000, 1),
    logLevel: reader.textOr('LOG_LEVEL', 'info'),
    trustProxy: reader.proxyList('TRUST_PROXY'),
    cookieSecure: reader.booleanFrom('COOKIE_SECURE', true),
    mediaRoot: reader.required('MEDIA_ROOT'),
    mediaUrl: reader.nonBlankOr('MEDIA_URL', '/media').replace(/\/+$/, ''),
    problemDataRoot: reader.required('PROBLEM_DATA_ROOT'),
    pdfCacheRoot: reader.required('PDF_CACHE_ROOT'),
    pdfConcurrency: reader.positiveInteger('PDF_CONCURRENCY', 2),
    judgeBridgePort: reader.portNumber('JUDGE_BRIDGE_PORT', 9999, 0),
    judgeBridgeHost: reader.nonBlankOr('JUDGE_BRIDGE_HOST', '0.0.0.0'),
    contestDataRoot: reader.nonBlankOr('CONTEST_DATA_ROOT', null),
    userDataRoot: reader.nonBlankOr('USER_DATA_ROOT', null),
  };
}

/** Values that parse but are unusable: a malformed key, a short secret, an unknown log level. */
function checkValues(env: Env): string[] {
  const problems: string[] = [];
  if (!/^[0-9a-f]{64}$/i.test(env.encryptionKey))
    problems.push('ENCRYPTION_KEY must be 64 hex chars');
  if (env.tokenSecret.length < 32)
    problems.push('TOKEN_SECRET must be at least 32 chars');
  if (!LOG_LEVELS.includes(env.logLevel))
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join('|')}`);
  return problems;
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const reader = new EnvReader(source);
  const env = readEnv(reader);
  const problems = [
    ...reader.problems,
    ...checkValues(env),
    ...checkDataRoots(env),
  ];
  if (problems.length)
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  return env;
}
