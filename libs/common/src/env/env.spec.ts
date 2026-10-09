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
        PDF_CONCURRENCY: undefined,
      }),
    ).toEqual({
      mongoUrl: valid.MONGO_URL,
      redisUrl: valid.REDIS_URL,
      encryptionKey: valid.ENCRYPTION_KEY,
      tokenSecret: valid.TOKEN_SECRET,
      siteUrl: valid.SITE_URL,
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      trustProxy: false,
      sseIpAllowlist: [],
      cookieSecure: true,
      mediaRoot: valid.MEDIA_ROOT,
      problemDataRoot: valid.PROBLEM_DATA_ROOT,
      pdfCacheRoot: valid.PDF_CACHE_ROOT,
      pdfConcurrency: 2,
      judgeBridgePort: 9999,
      judgeBridgeHost: '127.0.0.1',
      judgeBridgeTlsCert: null,
      judgeBridgeTlsKey: null,
      mediaUrl: '/media',
      contestDataRoot: null,
      userDataRoot: null,
    }));
  it('reads the optional user data root', () => {
    expect(loadEnv({ ...valid }).userDataRoot).toBeNull();
    expect(loadEnv({ ...valid, USER_DATA_ROOT: '' }).userDataRoot).toBeNull();
    expect(
      loadEnv({ ...valid, USER_DATA_ROOT: '/srv/user-data' }).userDataRoot,
    ).toBe('/srv/user-data');
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

  it('refuses user and contest data roots that are equal or nested', () => {
    const roots = (user: string, contest: string) => () =>
      loadEnv({ ...valid, USER_DATA_ROOT: user, CONTEST_DATA_ROOT: contest });
    expect(roots('/srv/data', '/srv/data')).toThrow(/USER_DATA_ROOT/);
    expect(roots('/srv/data/users', '/srv/data')).toThrow(/USER_DATA_ROOT/);
    expect(roots('/srv/data', '/srv/data/contests')).toThrow(/USER_DATA_ROOT/);
    expect(roots('/srv/user-data', '/srv/contest-data')).not.toThrow();
  });

  it('reports value problems before data-root problems', () =>
    expect(() =>
      loadEnv({
        ...valid,
        LOG_LEVEL: 'verbose',
        MEDIA_ROOT: '/srv/media',
        CONTEST_DATA_ROOT: '/srv/media/data',
      }),
    ).toThrow(
      'Invalid environment: LOG_LEVEL must be one of fatal|error|warn|info|debug|trace|silent; CONTEST_DATA_ROOT must not be inside MEDIA_ROOT',
    ));
  it('reads problems, then value checks, then data-root checks, each alone', () => {
    const messageFor = (overrides: Record<string, string>) => {
      try {
        loadEnv({ ...valid, ...overrides });
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(messageFor({ ENCRYPTION_KEY: 'a'.repeat(63) })).toBe(
      'Invalid environment: ENCRYPTION_KEY must be 64 hex chars',
    );
    expect(messageFor({ TOKEN_SECRET: 'a'.repeat(31) })).toBe(
      'Invalid environment: TOKEN_SECRET must be at least 32 chars',
    );
    expect(messageFor({ TOKEN_SECRET: 'a'.repeat(32) })).toBeUndefined();
    expect(
      messageFor({ PORT: '0', ENCRYPTION_KEY: 'zz', LOG_LEVEL: 'x' }),
    ).toBe(
      'Invalid environment: PORT must be 1-65535; ENCRYPTION_KEY must be 64 hex chars; LOG_LEVEL must be one of fatal|error|warn|info|debug|trace|silent',
    );
  });
  it('no longer reads a MOSS key', () => {
    expect(loadEnv({ ...valid, MOSS_API_KEY: '123456' })).not.toHaveProperty(
      'mossApiKey',
    );
  });
  it('reads the optional contest data root, blank meaning off', () => {
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
  it('parses flags and port', () =>
    expect(
      loadEnv({
        ...valid,
        PORT: '8080',
        TRUST_PROXY: 'loopback,10.0.0.0/8',
        COOKIE_SECURE: 'false',
      }),
    ).toMatchObject({
      port: 8080,
      trustProxy: 'loopback,10.0.0.0/8',
      cookieSecure: false,
    }));
  it('listens on loopback in production unless LISTEN_HOST says otherwise', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'production' }).host).toBe(
      '127.0.0.1',
    );
    expect(
      loadEnv({ ...valid, NODE_ENV: 'production', LISTEN_HOST: '10.0.0.5' })
        .host,
    ).toBe('10.0.0.5');
    expect(loadEnv({ ...valid, NODE_ENV: 'development' }).host).toBe('0.0.0.0');
  });

  it('reads PDF_CONCURRENCY', () =>
    expect(loadEnv({ ...valid, PDF_CONCURRENCY: '4' }).pdfConcurrency).toBe(4));
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
  it('reads the judge port TLS pair and refuses half of it', () => {
    const pair = {
      JUDGE_BRIDGE_TLS_CERT: '/etc/qhhoj/bridge.crt',
      JUDGE_BRIDGE_TLS_KEY: '/etc/qhhoj/bridge.key',
    };
    expect(loadEnv({ ...valid, ...pair })).toMatchObject({
      judgeBridgeTlsCert: '/etc/qhhoj/bridge.crt',
      judgeBridgeTlsKey: '/etc/qhhoj/bridge.key',
    });
    for (const half of ['JUDGE_BRIDGE_TLS_CERT', 'JUDGE_BRIDGE_TLS_KEY'])
      expect(() => loadEnv({ ...valid, [half]: '/etc/qhhoj/x.pem' })).toThrow(
        'JUDGE_BRIDGE_TLS_CERT and JUDGE_BRIDGE_TLS_KEY go together',
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
      'Invalid environment: MONGO_URL is required; REDIS_URL is required; SITE_URL is required; PORT must be 1-65535; MEDIA_ROOT is required; PROBLEM_DATA_ROOT is required; PDF_CACHE_ROOT is required; ENCRYPTION_KEY must be 64 hex chars; TOKEN_SECRET must be at least 32 chars',
    ));
  it.each(['true', '1', ''])('rejects TRUST_PROXY=%j', (value) =>
    expect(() => loadEnv({ ...valid, TRUST_PROXY: value })).toThrow(
      'TRUST_PROXY must be false or a comma-separated list of proxy addresses',
    ),
  );
  it('reads SSE_IP_ALLOWLIST as trimmed IPs and CIDRs', () => {
    expect(loadEnv({ ...valid, SSE_IP_ALLOWLIST: '' }).sseIpAllowlist).toEqual(
      [],
    );
    expect(
      loadEnv({
        ...valid,
        SSE_IP_ALLOWLIST: ' 203.0.113.7, 10.0.0.0/8 ,2001:db8::/32,',
      }).sseIpAllowlist,
    ).toEqual(['203.0.113.7', '10.0.0.0/8', '2001:db8::/32']);
  });
  it.each([
    'nope',
    '10.0.0.0/33',
    '2001:db8::/129',
    '1.2.3.4/',
    '1.2.3/8',
    '1.2.3.4/8/8',
  ])('rejects SSE_IP_ALLOWLIST entry %j', (entry) =>
    expect(() =>
      loadEnv({ ...valid, SSE_IP_ALLOWLIST: `10.0.0.1,${entry}` }),
    ).toThrow(
      /SSE_IP_ALLOWLIST must be a comma-separated list of IPs or CIDRs/,
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
