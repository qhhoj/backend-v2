export interface Env {
  mongoUrl: string;
  redisUrl: string;
  encryptionKey: string;
  tokenSecret: string;
  siteUrl: string;
  port: number;
  logLevel: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  /** null disables the Have I Been Pwned check. */
  pwnedApiUrl: string | null;
}

export const ENV = Symbol('ENV');

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const problems: string[] = [];
  const required = (name: string) =>
    source[name] || (problems.push(`${name} is required`), '');
  const flag = (name: string, fallback: boolean) =>
    source[name] === undefined ? fallback : source[name] === 'true';
  const env: Env = {
    mongoUrl: required('MONGO_URL'),
    redisUrl: required('REDIS_URL'),
    encryptionKey: source.ENCRYPTION_KEY ?? '',
    tokenSecret: source.TOKEN_SECRET ?? '',
    siteUrl: required('SITE_URL'),
    port: Number(source.PORT ?? 3000),
    logLevel: source.LOG_LEVEL ?? 'info',
    trustProxy: flag('TRUST_PROXY', false),
    cookieSecure: flag('COOKIE_SECURE', true),
    pwnedApiUrl:
      source.PWNED_API_URL === undefined
        ? 'https://api.pwnedpasswords.com'
        : source.PWNED_API_URL || null,
  };
  if (!/^[0-9a-f]{64}$/i.test(env.encryptionKey))
    problems.push('ENCRYPTION_KEY must be 64 hex chars');
  if (env.tokenSecret.length < 32)
    problems.push('TOKEN_SECRET must be at least 32 chars');
  if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535)
    problems.push('PORT must be 1-65535');
  if (problems.length)
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  return env;
}
