import { loadEnv } from './env';
import { validEnv } from './env.fixture';

const valid = validEnv;

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
      smtpUrl: valid.SMTP_URL,
      mailFrom: 'QHHOJ <no-reply@qhhoj.local>',
      mediaRoot: valid.MEDIA_ROOT,
      problemDataRoot: valid.PROBLEM_DATA_ROOT,
      pdfCacheRoot: valid.PDF_CACHE_ROOT,
      mediaUrl: '/media',
      oauth: { google: null, facebook: null, github: null },
    }));
  it('enables an oauth provider only with both client id and secret', () =>
    expect(
      loadEnv({
        ...valid,
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
      }).oauth,
    ).toEqual({
      google: null,
      facebook: null,
      github: { clientId: 'id', clientSecret: 'secret' },
    }));
  it.each([
    ['GOOGLE', { GOOGLE_CLIENT_ID: 'id' }],
    ['FACEBOOK', { FACEBOOK_CLIENT_SECRET: 'secret' }],
  ])('rejects a half-configured %s provider', (name, partial) =>
    expect(() => loadEnv({ ...valid, ...partial })).toThrow(
      `${name} requires both CLIENT_ID and CLIENT_SECRET`,
    ),
  );
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
  it('strips the trailing slash of MEDIA_URL', () =>
    expect(
      loadEnv({ ...valid, MEDIA_URL: 'https://cdn.test/media/' }).mediaUrl,
    ).toBe('https://cdn.test/media'));
  it('reports every problem at once', () =>
    expect(() =>
      loadEnv({ ENCRYPTION_KEY: 'zz', TOKEN_SECRET: 'short', PORT: '0' }),
    ).toThrow(
      'Invalid environment: MONGO_URL is required; REDIS_URL is required; SITE_URL is required; SMTP_URL is required; MEDIA_ROOT is required; PROBLEM_DATA_ROOT is required; PDF_CACHE_ROOT is required; ENCRYPTION_KEY must be 64 hex chars; TOKEN_SECRET must be at least 32 chars; PORT must be 1-65535',
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
  it('reads MAIL_FROM', () =>
    expect(loadEnv({ ...valid, MAIL_FROM: 'Me <me@x.test>' }).mailFrom).toBe(
      'Me <me@x.test>',
    ));
  it.each(['http://x', 'localhost:25'])('rejects SMTP_URL=%s', (value) =>
    expect(() => loadEnv({ ...valid, SMTP_URL: value })).toThrow(
      'SMTP_URL must start with smtp:// or smtps://',
    ),
  );
  it('rejects unknown LOG_LEVEL', () =>
    expect(() => loadEnv({ ...valid, LOG_LEVEL: 'verbose' })).toThrow(
      'LOG_LEVEL must be one of fatal|error|warn|info|debug|trace|silent',
    ));
});
