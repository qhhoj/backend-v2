import { ENCRYPTION_KEY_PROBLEM, isEncryptionKey } from '../crypto/aes-gcm';
import { PINO_LEVELS } from '../log-levels';
import { checkDataRoots } from './data-roots';
import type { EnvReader } from './env-reader';
import { parseIpList } from './ip-allowlist';

/** A group of env vars a process may declare: `read` parses them, `check` refuses values that parse but are unusable. */
export interface ConfigPart<Config> {
  read(reader: EnvReader): Config;
  check?(config: Config): string[];
}

export interface LoggingConfig {
  logLevel: string;
}
export const logging: ConfigPart<LoggingConfig> = {
  read: (reader) => ({ logLevel: reader.text('LOG_LEVEL', 'info') }),
  check: ({ logLevel }) =>
    PINO_LEVELS.includes(logLevel)
      ? []
      : [`LOG_LEVEL must be one of ${PINO_LEVELS.join('|')}`],
};

export interface MongoConfig {
  mongoUrl: string;
}
export const mongo: ConfigPart<MongoConfig> = {
  read: (reader) => ({ mongoUrl: reader.required('MONGO_URL') }),
};

export interface RedisConfig {
  redisUrl: string;
}
export const redis: ConfigPart<RedisConfig> = {
  read: (reader) => ({ redisUrl: reader.required('REDIS_URL') }),
};

export interface EncryptionConfig {
  /** Seals stored secrets (settings, second factor); the settings module turns it into the key. */
  encryptionKey: string;
}
export const encryption: ConfigPart<EncryptionConfig> = {
  read: (reader) => ({ encryptionKey: reader.text('ENCRYPTION_KEY') }),
  check: ({ encryptionKey }) =>
    isEncryptionKey(encryptionKey) ? [] : [ENCRYPTION_KEY_PROBLEM],
};

export interface SiteConfig {
  /** Public origin: the cookie Origin check, OAuth callbacks and links in mails, feeds and PDFs. */
  siteUrl: string;
}
export const site: ConfigPart<SiteConfig> = {
  read: (reader) => ({ siteUrl: reader.required('SITE_URL') }),
};

export interface WebConfig {
  tokenSecret: string;
  /** Keys and signs the Redis session records. Rotating it ends every session. */
  sessionSecret: string;
  /** false, or a comma-separated list of proxy addresses (IPs/CIDRs/`loopback`) whose forwarding headers are trusted. */
  trustProxy: false | string;
  /** Client IPs/CIDRs (IPv4 or IPv6) that may hold more live event streams than `perIp` (a school lab behind one NAT); empty means none. */
  sseIpAllowlist: string[];
  cookieSecure: boolean;
}

function readTrustProxy(reader: EnvReader): false | string {
  const value = reader.text('TRUST_PROXY', 'false');
  if (value === 'false') return false;
  if (value === 'true' || /^\s*\d*\s*$/.test(value)) {
    reader.problem(
      'TRUST_PROXY must be false or a comma-separated list of proxy addresses',
    );
    return false;
  }
  return value;
}

function readIpList(reader: EnvReader, name: string): string[] {
  const { entries, invalid } = parseIpList(reader.text(name));
  if (!invalid.length) return entries;
  reader.problem(
    `${name} must be a comma-separated list of IPs or CIDRs, got ${invalid.join(', ')}`,
  );
  return [];
}

export const SESSION_SECRET_PROBLEM =
  'SESSION_SECRET must be at least 32 bytes';
export const isSessionSecret = (secret: unknown): secret is string =>
  typeof secret === 'string' && Buffer.byteLength(secret) >= 32;

/** The HTTP side of the api: tokens, sessions, proxies, event streams and cookies. */
export const web: ConfigPart<WebConfig> = {
  read: (reader) => ({
    tokenSecret: reader.text('TOKEN_SECRET'),
    sessionSecret: reader.text('SESSION_SECRET'),
    trustProxy: readTrustProxy(reader),
    sseIpAllowlist: readIpList(reader, 'SSE_IP_ALLOWLIST'),
    cookieSecure: reader.booleanFrom('COOKIE_SECURE', true),
  }),
  check: ({ tokenSecret, sessionSecret }) => [
    ...(tokenSecret.length < 32
      ? ['TOKEN_SECRET must be at least 32 chars']
      : []),
    ...(isSessionSecret(sessionSecret) ? [] : [SESSION_SECRET_PROBLEM]),
  ],
};

export interface ListenConfig {
  /** Interface the api listens on; loopback unless set, since nginx is the edge in production. */
  host: string;
  port: number;
}
export const listen: ConfigPart<ListenConfig> = {
  read: (reader) => ({
    host: reader.nonBlankOr('LISTEN_HOST', '127.0.0.1'),
    port: reader.integer('PORT', 3000, 1, 65535),
  }),
};

export interface MediaConfig {
  /** Directory of uploaded files (images, PDF statements, materials, submission files); nginx serves it at `mediaUrl`. */
  mediaRoot: string;
  /** Public URL prefix of `mediaRoot`, without a trailing slash. */
  mediaUrl: string;
}
export const media: ConfigPart<MediaConfig> = {
  read: (reader) => ({
    mediaRoot: reader.required('MEDIA_ROOT'),
    mediaUrl: reader.nonBlankOr('MEDIA_URL', '/media').replace(/\/+$/, ''),
  }),
};

/** The media root and the data roots the api serves and the worker writes; both processes declare this part, so both read the same four variables. */
export interface DataRootsConfig extends MediaConfig {
  /** Shared judge volume: `<root>/<code>/` holds init.yml, the archive and checker/grader sources. */
  problemDataRoot: string;
  /** Rendered statement PDFs (`<root>/<code>.<lang>.pdf`) and package zips (`<root>/packages`). */
  pdfCacheRoot: string;
  /** Contest data zips; null disables data download. Not under MEDIA_ROOT (served publicly). */
  contestDataRoot: string | null;
  /** Exported user data zips; null disables the export. Not under MEDIA_ROOT (served publicly). */
  userDataRoot: string | null;
}
export const dataRoots: ConfigPart<DataRootsConfig> = {
  read: (reader) => ({
    ...media.read(reader),
    problemDataRoot: reader.required('PROBLEM_DATA_ROOT'),
    pdfCacheRoot: reader.required('PDF_CACHE_ROOT'),
    contestDataRoot: reader.nonBlankOr('CONTEST_DATA_ROOT', null),
    userDataRoot: reader.nonBlankOr('USER_DATA_ROOT', null),
  }),
  check: checkDataRoots,
};

export interface PdfRenderConfig {
  /** PDF renders the worker runs at once. */
  pdfConcurrency: number;
}
export const pdfRender: ConfigPart<PdfRenderConfig> = {
  read: (reader) => ({
    pdfConcurrency: reader.integer('PDF_CONCURRENCY', 2, 1),
  }),
};

export interface JudgeLinkConfig {
  /** Judges connect to this port (gRPC `qhhoj.judge.v1`); 0 picks a free port (tests). */
  judgeBridgePort: number;
  /** Interface the judge port listens on; loopback by default. Any other address needs the TLS pair below. */
  judgeBridgeHost: string;
  /** PEM certificate chain and private key of the judge port; both or neither. Without them the bridge serves only on loopback. */
  judgeBridgeTlsCert: string | null;
  judgeBridgeTlsKey: string | null;
}
export const judgeLink: ConfigPart<JudgeLinkConfig> = {
  read: (reader) => ({
    judgeBridgePort: reader.integer('JUDGE_BRIDGE_PORT', 9999, 0, 65535),
    judgeBridgeHost: reader.nonBlankOr('JUDGE_BRIDGE_HOST', '127.0.0.1'),
    judgeBridgeTlsCert: reader.nonBlankOr('JUDGE_BRIDGE_TLS_CERT', null),
    judgeBridgeTlsKey: reader.nonBlankOr('JUDGE_BRIDGE_TLS_KEY', null),
  }),
  check: ({ judgeBridgeTlsCert, judgeBridgeTlsKey }) =>
    (judgeBridgeTlsCert === null) !== (judgeBridgeTlsKey === null)
      ? ['JUDGE_BRIDGE_TLS_CERT and JUDGE_BRIDGE_TLS_KEY go together']
      : [],
};
