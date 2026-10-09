import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/release/tag-release.mjs');
const CHANGELOG =
  '# app\n\n## 2.1.0\n\n- newer\n\n## 2.0.0\n\n### Minor Changes\n\n- first\n\n## 1.0.0\n\n- old\n';

let root: string;
let work: string;
let remote: string;

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).stdout.trim();
const run = (env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_TOKEN: '', ...env },
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tag-release-'));
  remote = join(root, 'remote.git');
  work = join(root, 'work');
  spawnSync('git', ['init', '--bare', '-q', remote]);
  spawnSync('git', ['init', '-q', '-b', 'main', work]);
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'x', version: '2.0.0' }),
  );
  writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG);
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'add', '.');
  git(
    work,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '-m',
    'init',
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('release:tag', () => {
  it('tags the package.json version and pushes the tag', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(git(work, 'tag', '--list')).toBe('v2.0.0');
    expect(git(remote, 'tag', '--list')).toBe('v2.0.0');
  });

  it('does nothing when the tag already exists on the remote only', () => {
    git(work, 'push', 'origin', 'HEAD:refs/tags/v2.0.0');
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('already exists');
    expect(git(work, 'tag', '--list')).toBe('');
  });

  it('is idempotent across runs', () => {
    run();
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already exists');
    expect(git(remote, 'tag', '--list')).toBe('v2.0.0');
  });

  it('creates a GitHub Release from the CHANGELOG section when a token is set', () => {
    const bin = join(root, 'bin');
    const log = join(root, 'gh.log');
    mkdirSync(bin);
    const stub = join(bin, 'gh');
    writeFileSync(
      stub,
      `#!/bin/sh\necho "$@" > "${log}"\ncat "$8" >> "${log}"\n`,
    );
    chmodSync(stub, 0o755);
    const result = run({
      GITHUB_TOKEN: 'x',
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect(result.status).toBe(0);
    const logged = readFileSync(log, 'utf8');
    expect(logged).toContain('release create v2.0.0');
    expect(logged).toContain('- first');
    expect(logged).not.toContain('newer');
    expect(logged).not.toContain('old');
  });
});
