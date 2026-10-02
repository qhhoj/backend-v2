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
        TRUST_PROXY: 'true',
        COOKIE_SECURE: 'false',
        PWNED_API_URL: '',
      }),
    ).toMatchObject({
      port: 8080,
      trustProxy: true,
      cookieSecure: false,
      pwnedApiUrl: null,
    }));
  it('reports every problem at once', () =>
    expect(() =>
      loadEnv({ ENCRYPTION_KEY: 'zz', TOKEN_SECRET: 'short', PORT: '0' }),
    ).toThrow(
      'Invalid environment: MONGO_URL is required; REDIS_URL is required; SITE_URL is required; ENCRYPTION_KEY must be 64 hex chars; TOKEN_SECRET must be at least 32 chars; PORT must be 1-65535',
    ));
});
