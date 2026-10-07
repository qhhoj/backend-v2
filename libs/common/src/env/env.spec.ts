import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from './env';
import { validEnv } from './env.fixture';

const valid = validEnv;

describe('loadEnv', () => {
  it('applies defaults', () =>
    expect(
      loadEnv({
        ...valid,
        PDF_RENDER_TIMEOUT_MS: undefined,
        PDF_MAX_BYTES: undefined,
        PDF_CONCURRENCY: undefined,
      }),
    ).toEqual({
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
      pdfRenderTimeoutMs: 30000,
      pdfMaxBytes: 52428800,
      pdfConcurrency: 2,
      contestBanAfterDisqualifications: 0,
      judgeBridgePort: 9999,
      judgeBridgeHost: '0.0.0.0',
      mediaUrl: '/media',
      mossApiKey: null,
      contestDataRoot: null,
      userDataRoot: null,
      officialContestMode: false,
      oauth: { google: null, facebook: null, github: null },
    }));
  it('reads the optional user data root and official contest mode', () => {
    expect(loadEnv({ ...valid }).userDataRoot).toBeNull();
    expect(loadEnv({ ...valid, USER_DATA_ROOT: '' }).userDataRoot).toBeNull();
    expect(
      loadEnv({ ...valid, USER_DATA_ROOT: '/srv/user-data' }).userDataRoot,
    ).toBe('/srv/user-data');
    expect(
      loadEnv({ ...valid, OFFICIAL_CONTEST_MODE: 'true' }).officialContestMode,
    ).toBe(true);
    expect(() => loadEnv({ ...valid, OFFICIAL_CONTEST_MODE: 'yes' })).toThrow(
      /OFFICIAL_CONTEST_MODE/,
    );
  });

  it('refuses a user data root inside MEDIA_ROOT', () => {
    expect(() =>
      loadEnv({
        ...valid,
        MEDIA_ROOT: '/srv/media',
        USER_DATA_ROOT: '/srv/media/users',
      }),
    ).toThrow(/USER_DATA_ROOT/);
    expect(() =>
      loadEnv({
        ...valid,
        MEDIA_ROOT: '/srv/media',
        USER_DATA_ROOT: '/srv/user-data',
      }),
    ).not.toThrow();
  });

  it('reads the optional MOSS key and contest data root, blank meaning off', () => {
    expect(loadEnv({ ...valid }).mossApiKey).toBeNull();
    expect(loadEnv({ ...valid, MOSS_API_KEY: '' }).mossApiKey).toBeNull();
    expect(loadEnv({ ...valid, MOSS_API_KEY: '123456' }).mossApiKey).toBe(
      '123456',
    );
    expect(loadEnv({ ...valid }).contestDataRoot).toBeNull();
    expect(
      loadEnv({ ...valid, CONTEST_DATA_ROOT: '/srv/contest-data' })
        .contestDataRoot,
    ).toBe('/srv/contest-data');
    expect(
      loadEnv({ ...valid, CONTEST_DATA_ROOT: '' }).contestDataRoot,
    ).toBeNull();
  });
  it('refuses a contest data root inside MEDIA_ROOT', () => {
    const withRoot = (root: string) => () =>
      loadEnv({
        ...valid,
        MEDIA_ROOT: '/srv/media',
        CONTEST_DATA_ROOT: root,
      });
    expect(withRoot('/srv/media/data')).toThrow(/CONTEST_DATA_ROOT/);
    expect(withRoot('/srv/media/..cache')).toThrow(/CONTEST_DATA_ROOT/);
    expect(withRoot('/srv/media')).toThrow(/CONTEST_DATA_ROOT/);
    expect(withRoot('/srv/media-data')).not.toThrow();
  });
  it('refuses a contest data root that reaches MEDIA_ROOT through a symlink', () => {
    const base = mkdtempSync(join(tmpdir(), 'qhhoj-env-'));
    try {
      mkdirSync(join(base, 'media/data'), { recursive: true });
      symlinkSync(join(base, 'media/data'), join(base, 'link'));
      const withRoot = (root: string) => () =>
        loadEnv({
          ...valid,
          MEDIA_ROOT: join(base, 'media'),
          CONTEST_DATA_ROOT: root,
        });
      expect(withRoot(join(base, 'link'))).toThrow(/CONTEST_DATA_ROOT/);
      // Not yet created below the link.
      expect(withRoot(join(base, 'link/new'))).toThrow(/CONTEST_DATA_ROOT/);
      expect(withRoot(join(base, 'elsewhere'))).not.toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
  it('reads the disqualification ban threshold', () => {
    expect(
      loadEnv({ ...valid, CONTEST_BAN_AFTER_DISQUALIFICATIONS: '3' })
        .contestBanAfterDisqualifications,
    ).toBe(3);
    for (const bad of ['-1', '1.5', 'x'])
      expect(() =>
        loadEnv({ ...valid, CONTEST_BAN_AFTER_DISQUALIFICATIONS: bad }),
      ).toThrow('CONTEST_BAN_AFTER_DISQUALIFICATIONS');
  });
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
  it('reads the PDF render limits', () =>
    expect(
      loadEnv({
        ...valid,
        PDF_RENDER_TIMEOUT_MS: '200',
        PDF_MAX_BYTES: '1000',
        PDF_CONCURRENCY: '4',
      }),
    ).toMatchObject({
      pdfRenderTimeoutMs: 200,
      pdfMaxBytes: 1000,
      pdfConcurrency: 4,
    }));
  it.each(['0', '-1', '1.5', 'abc', ''])(
    'rejects PDF_CONCURRENCY=%j',
    (value) =>
      expect(() => loadEnv({ ...valid, PDF_CONCURRENCY: value })).toThrow(
        'PDF_CONCURRENCY must be a positive integer',
      ),
  );
  it('accepts 0 (any free port) for the judge bridge and rejects out-of-range ports', () => {
    expect(loadEnv({ ...valid, JUDGE_BRIDGE_PORT: '0' }).judgeBridgePort).toBe(
      0,
    );
    expect(loadEnv({ ...valid, JUDGE_BRIDGE_PORT: '' }).judgeBridgePort).toBe(
      9999,
    );
    for (const port of ['65536', '-1', '1.5', 'nine'])
      expect(() => loadEnv({ ...valid, JUDGE_BRIDGE_PORT: port })).toThrow(
        'JUDGE_BRIDGE_PORT must be 0-65535',
      );
  });
  it('strips the trailing slash of MEDIA_URL', () =>
    expect(
      loadEnv({ ...valid, MEDIA_URL: 'https://cdn.test/media/' }).mediaUrl,
    ).toBe('https://cdn.test/media'));
  it('reports every problem at once', () =>
    expect(() =>
      loadEnv({ ENCRYPTION_KEY: 'zz', TOKEN_SECRET: 'short', PORT: '0' }),
    ).toThrow(
      'Invalid environment: MONGO_URL is required; REDIS_URL is required; SITE_URL is required; PORT must be 1-65535; SMTP_URL is required; MEDIA_ROOT is required; PROBLEM_DATA_ROOT is required; PDF_CACHE_ROOT is required; ENCRYPTION_KEY must be 64 hex chars; TOKEN_SECRET must be at least 32 chars',
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
