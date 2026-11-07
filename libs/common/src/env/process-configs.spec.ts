import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TEST_ENV } from '../testing';
import type { ProcessConfig } from './env';
import type { EnvSource } from './env-reader';
import {
  apiConfig,
  bridgeConfig,
  indexesConfig,
  workerConfig,
} from './process-configs';

const REPO = resolve(__dirname, '../../../..');
const repoFile = (path: string) => readFileSync(join(REPO, path), 'utf8');

/** `KEY=value` lines of an env file, comments skipped. */
const envFile = (path: string): Record<string, string> =>
  Object.fromEntries(
    repoFile(path)
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );

/** The templates leave the secrets blank (generated on install). */
const SECRETS = {
  ENCRYPTION_KEY: 'ab'.repeat(32),
  TOKEN_SECRET: 'x'.repeat(32),
  SESSION_SECRET: 'y'.repeat(32),
};
const production: Record<string, string> = {
  ...envFile('deploy/env.production.example'),
  ...SECRETS,
};
const PROCESSES: Record<string, ProcessConfig<object>> = {
  api: apiConfig,
  worker: workerConfig,
  bridge: bridgeConfig,
  indexes: indexesConfig,
};
/** What each process cannot boot without: the deploy contract, so a change here is a host env change. */
const REQUIRED: Record<string, string[]> = {
  api: [
    'MONGO_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY',
    'SITE_URL',
    'TOKEN_SECRET',
    'SESSION_SECRET',
    'MEDIA_ROOT',
    'PROBLEM_DATA_ROOT',
    'PDF_CACHE_ROOT',
  ],
  worker: [
    'MONGO_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY',
    'SITE_URL',
    'MEDIA_ROOT',
    'PROBLEM_DATA_ROOT',
    'PDF_CACHE_ROOT',
  ],
  bridge: ['MONGO_URL', 'REDIS_URL', 'ENCRYPTION_KEY', 'MEDIA_ROOT'],
  indexes: ['MONGO_URL'],
};

const pick = (source: EnvSource, names: string[]) =>
  Object.fromEntries(names.map((name) => [name, source[name]]));
const omit = (source: EnvSource, name: string) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => key !== name));

/** The variables `config` reads while loading `source`. */
function namesRead(config: ProcessConfig<object>, source: EnvSource) {
  const names = new Set<string>();
  config.load(
    new Proxy(source, {
      get: (target, name: string) => (names.add(name), target[name]),
    }),
  );
  return names;
}
const namesReadByAny = (source: EnvSource) =>
  new Set(
    Object.values(PROCESSES).flatMap((config) => [
      ...namesRead(config, source),
    ]),
  );

const problemsOf = (load: () => unknown) => {
  try {
    load();
  } catch (error) {
    return (error as Error).message;
  }
};

describe.each(Object.keys(PROCESSES))('the %s config', (name) => {
  const config = PROCESSES[name];
  it('accepts the production template and ignores the variables of other processes', () =>
    expect(() => config.load(production)).not.toThrow());
  it('boots from its required variables alone', () =>
    expect(() => config.load(pick(production, REQUIRED[name]))).not.toThrow());
  it.each(REQUIRED[name])('refuses to boot without %s', (variable) =>
    expect(problemsOf(() => config.load(omit(production, variable)))).toMatch(
      variable,
    ),
  );
  it('accepts the test env with its data roots', () =>
    expect(() =>
      config.load({
        ...TEST_ENV,
        MONGO_URL: 'mongodb://localhost/qhhoj',
        MEDIA_ROOT: '/tmp/media',
        PROBLEM_DATA_ROOT: '/tmp/problem-data',
        PDF_CACHE_ROOT: '/tmp/pdf-cache',
      }),
    ).not.toThrow());
  it('is given its required variables by stack:up', () => {
    const stackNames = [
      ...repoFile('scripts/fullstack/up.sh').matchAll(/^export ([A-Z_]+)=/gm),
    ].map(([, variable]) => variable);
    expect(stackNames).toEqual(expect.arrayContaining(REQUIRED[name]));
  });
});

describe('the env examples', () => {
  it('the production template lists exactly the variables the processes read', () =>
    expect([...namesReadByAny(production)].sort()).toEqual(
      Object.keys(production).sort(),
    ));
  it('the dev example names only variables a process or jest reads', () => {
    const dev = { ...envFile('.env.example'), ...SECRETS };
    const known = new Set([...namesReadByAny(dev), 'TEST_REDIS_URL']);
    expect(Object.keys(dev).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe('config values', () => {
  const api = (overrides: EnvSource) =>
    problemsOf(() => apiConfig.load({ ...production, ...overrides }));

  it('reports every problem at once: read problems, then checks in part order', () =>
    expect(
      problemsOf(() =>
        apiConfig.load({
          ENCRYPTION_KEY: 'zz',
          TOKEN_SECRET: 'short',
          PORT: '0',
          LOG_LEVEL: 'x',
        }),
      ),
    ).toBe(
      'Invalid environment: MONGO_URL is required; REDIS_URL is required; SITE_URL is required; PORT must be 1-65535; MEDIA_ROOT is required; PROBLEM_DATA_ROOT is required; PDF_CACHE_ROOT is required; LOG_LEVEL must be one of fatal|error|warn|info|debug|trace|silent; ENCRYPTION_KEY must be 32 bytes (64 hex chars); TOKEN_SECRET must be at least 32 chars; SESSION_SECRET must be at least 32 bytes',
    ));
  it('checks the secrets', () => {
    expect(api({ ENCRYPTION_KEY: 'a'.repeat(63) })).toMatch(/ENCRYPTION_KEY/);
    expect(api({ TOKEN_SECRET: 'a'.repeat(31) })).toMatch(/TOKEN_SECRET/);
    expect(api({ TOKEN_SECRET: 'a'.repeat(32) })).toBeUndefined();
    expect(api({ SESSION_SECRET: 'é'.repeat(15) })).toMatch(
      'SESSION_SECRET must be at least 32 bytes',
    );
    expect(api({ SESSION_SECRET: 'é'.repeat(16) })).toBeUndefined();
  });
  it('refuses a contest data root inside MEDIA_ROOT', () => {
    const withRoot = (root: string) =>
      api({ MEDIA_ROOT: '/srv/media', CONTEST_DATA_ROOT: root });
    expect(withRoot('/srv/media/data')).toMatch(/CONTEST_DATA_ROOT/);
    expect(withRoot('/srv/media/..cache')).toMatch(/CONTEST_DATA_ROOT/);
    expect(withRoot('/srv/media')).toMatch(/CONTEST_DATA_ROOT/);
    expect(withRoot('/srv/media-data')).toBeUndefined();
  });
  it('refuses a contest data root that reaches MEDIA_ROOT through a symlink', () => {
    const base = mkdtempSync(join(tmpdir(), 'qhhoj-env-'));
    try {
      mkdirSync(join(base, 'media/data'), { recursive: true });
      symlinkSync(join(base, 'media/data'), join(base, 'link'));
      const withRoot = (root: string) =>
        api({ MEDIA_ROOT: join(base, 'media'), CONTEST_DATA_ROOT: root });
      expect(withRoot(join(base, 'link'))).toMatch(/CONTEST_DATA_ROOT/);
      // Not yet created below the link.
      expect(withRoot(join(base, 'link/new'))).toMatch(/CONTEST_DATA_ROOT/);
      expect(withRoot(join(base, 'elsewhere'))).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
  it('listens on loopback unless LISTEN_HOST says otherwise, whatever NODE_ENV is', () => {
    const unset = omit(production, 'LISTEN_HOST');
    for (const NODE_ENV of ['production', 'development', undefined])
      expect(apiConfig.load({ ...unset, NODE_ENV }).host).toBe('127.0.0.1');
    expect(apiConfig.load({ ...unset, LISTEN_HOST: '' }).host).toBe(
      '127.0.0.1',
    );
    expect(
      apiConfig.load({
        ...unset,
        NODE_ENV: 'production',
        LISTEN_HOST: '0.0.0.0',
      }).host,
    ).toBe('0.0.0.0');
  });
  it.each(['0', '-1', '1.5', 'abc'])('rejects PDF_CONCURRENCY=%j', (value) =>
    expect(() =>
      workerConfig.load({ ...production, PDF_CONCURRENCY: value }),
    ).toThrow('PDF_CONCURRENCY must be an integer of at least 1'),
  );
  it('accepts 0 (any free port) for the judge bridge and rejects out-of-range ports', () => {
    const port = (value: string) =>
      bridgeConfig.load({ ...production, JUDGE_BRIDGE_PORT: value })
        .judgeBridgePort;
    expect(port('0')).toBe(0);
    expect(port('')).toBe(9999);
    for (const value of ['65536', '-1', '1.5', 'nine'])
      expect(() => port(value)).toThrow('JUDGE_BRIDGE_PORT must be 0-65535');
  });
  it('reads the judge port TLS pair and refuses half of it', () => {
    expect(bridgeConfig.load(production)).toMatchObject({
      judgeBridgeTlsCert: production.JUDGE_BRIDGE_TLS_CERT,
      judgeBridgeTlsKey: production.JUDGE_BRIDGE_TLS_KEY,
    });
    for (const half of ['JUDGE_BRIDGE_TLS_CERT', 'JUDGE_BRIDGE_TLS_KEY'])
      expect(() => bridgeConfig.load(omit(production, half))).toThrow(
        'JUDGE_BRIDGE_TLS_CERT and JUDGE_BRIDGE_TLS_KEY go together',
      );
  });
  it.each(['true', '1', ''])('rejects TRUST_PROXY=%j', (value) =>
    expect(api({ TRUST_PROXY: value })).toMatch(
      'TRUST_PROXY must be false or a comma-separated list of proxy addresses',
    ),
  );
  it('reads SSE_IP_ALLOWLIST as trimmed IPs and CIDRs', () => {
    const allowlist = (value: string) =>
      apiConfig.load({ ...production, SSE_IP_ALLOWLIST: value }).sseIpAllowlist;
    expect(allowlist('')).toEqual([]);
    expect(allowlist(' 203.0.113.7, 10.0.0.0/8 ,2001:db8::/32,')).toEqual([
      '203.0.113.7',
      '10.0.0.0/8',
      '2001:db8::/32',
    ]);
  });
  it.each([
    'nope',
    '10.0.0.0/33',
    '2001:db8::/129',
    '1.2.3.4/',
    '1.2.3/8',
    '1.2.3.4/8/8',
  ])('rejects SSE_IP_ALLOWLIST entry %j', (entry) =>
    expect(api({ SSE_IP_ALLOWLIST: `10.0.0.1,${entry}` })).toMatch(
      /SSE_IP_ALLOWLIST must be a comma-separated list of IPs or CIDRs/,
    ),
  );
  it.each(['True', '1', 'yes'])('rejects COOKIE_SECURE=%s', (value) =>
    expect(api({ COOKIE_SECURE: value })).toMatch(
      'COOKIE_SECURE must be true or false',
    ),
  );
});
