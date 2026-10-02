import { loadEnv } from './env';

const valid = {
  MONGO_URL: 'mongodb://localhost/qhhoj',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'ab'.repeat(32),
  TOKEN_SECRET: 'x'.repeat(32),
  SITE_URL: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('applies defaults', () =>
    expect(loadEnv(valid)).toEqual({
      mongoUrl: valid.MONGO_URL,
      redisUrl: valid.REDIS_URL,
      encryptionKey: valid.ENCRYPTION_KEY,
      tokenSecret: valid.TOKEN_SECRET,
      siteUrl: valid.SITE_URL,
      port: 3000,
      logLevel: 'info',
      trustProxy: false,
      cookieSecure: true,
      pwnedApiUrl: 'https://api.pwnedpasswords.com',
    }));
  it('parses flags, port and disabled pwned check', () =>
    expect(
      loadEnv({
        ...valid,
        PORT: '8080',
        TRUST_PROXY: 'loopback,10.0.0.0/8',
        COOKIE_SECURE: 'false',
        PWNED_API_URL: '',
      }),
    ).toMatchObject({
      port: 8080,
      trustProxy: 'loopback,10.0.0.0/8',
      cookieSecure: false,
      pwnedApiUrl: null,
    }));
  it('reports every problem at once', () =>
    expect(() =>
      loadEnv({ ENCRYPTION_KEY: 'zz', TOKEN_SECRET: 'short', PORT: '0' }),
    ).toThrow(
      'Invalid environment: MONGO_URL is required; REDIS_URL is required; SITE_URL is required; ENCRYPTION_KEY must be 64 hex chars; TOKEN_SECRET must be at least 32 chars; PORT must be 1-65535',
    ));
  it.each(['true', '1', ''])('rejects TRUST_PROXY=%j', (value) =>
    expect(() => loadEnv({ ...valid, TRUST_PROXY: value })).toThrow(
      'TRUST_PROXY must be false or a comma-separated list of proxy addresses',
    ),
  );
  it('treats TRUST_PROXY=false as off', () =>
    expect(loadEnv({ ...valid, TRUST_PROXY: 'false' }).trustProxy).toBe(false));
  it.each(['True', '1', 'yes'])('rejects COOKIE_SECURE=%s', (value) =>
    expect(() => loadEnv({ ...valid, COOKIE_SECURE: value })).toThrow(
      'COOKIE_SECURE must be true or false',
    ),
  );
  it('rejects unknown LOG_LEVEL', () =>
    expect(() => loadEnv({ ...valid, LOG_LEVEL: 'verbose' })).toThrow(
      'LOG_LEVEL must be one of fatal|error|warn|info|debug|trace|silent',
    ));
});
