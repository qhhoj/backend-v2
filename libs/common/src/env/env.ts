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
  const env: Env = {
    mongoUrl: required('MONGO_URL'),
    redisUrl: required('REDIS_URL'),
    encryptionKey: source.ENCRYPTION_KEY ?? '',
    tokenSecret: source.TOKEN_SECRET ?? '',
    siteUrl: required('SITE_URL'),
    port: Number(source.PORT ?? 3000),
    logLevel: source.LOG_LEVEL ?? 'info',
    trustProxy: proxies('TRUST_PROXY'),
    cookieSecure: flag('COOKIE_SECURE', true),
    pwnedApiUrl:
      source.PWNED_API_URL === undefined
        ? 'https://api.pwnedpasswords.com'
        : source.PWNED_API_URL || null,
    smtpUrl: required('SMTP_URL'),
    mailFrom: source.MAIL_FROM || 'QHHOJ <no-reply@qhhoj.local>',
  };
  if (!/^[0-9a-f]{64}$/i.test(env.encryptionKey))
    problems.push('ENCRYPTION_KEY must be 64 hex chars');
  if (env.tokenSecret.length < 32)
    problems.push('TOKEN_SECRET must be at least 32 chars');
  if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535)
    problems.push('PORT must be 1-65535');
  if (!LOG_LEVELS.includes(env.logLevel))
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join('|')}`);
  if (problems.length)
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  return env;
}
