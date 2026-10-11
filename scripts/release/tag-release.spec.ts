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
// Fake gh: a matching-refs lookup prints $STUB_EXISTING_SHA; every call is logged, release notes included.
const GH_STUB = (log: string) => `#!/bin/sh
echo "$@" >> "${log}"
case "$2" in
  */matching-refs/*) printf '%s' "$STUB_EXISTING_SHA" ;;
esac
if [ "$1" = release ]; then cat "$8" >> "${log}"; fi
`;

let root: string;
let work: string;
let log: string;

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).stdout.trim();
const run = (existingSha = '') =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'o/r',
      STUB_EXISTING_SHA: existingSha,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    },
  });
const ghCalls = () => readFileSync(log, 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tag-release-'));
  work = join(root, 'work');
  log = join(root, 'gh.log');
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'gh'), GH_STUB(log));
  chmodSync(join(root, 'bin', 'gh'), 0o755);
  writeFileSync(log, '');
  spawnSync('git', ['init', '-q', '-b', 'main', work]);
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'x', version: '2.0.0' }),
  );
  writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG);
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
  it('creates the tag at HEAD through the API, without a git push', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(ghCalls()).toContain(
      `api repos/o/r/git/refs -f ref=refs/tags/v2.0.0 -f sha=${git(work, 'rev-parse', 'HEAD')}`,
    );
    expect(git(work, 'tag', '--list')).toBe('');
  });

  it('creates a GitHub Release from the CHANGELOG section', () => {
    expect(run().status).toBe(0);
    const logged = ghCalls();
    expect(logged).toContain('release create v2.0.0');
    expect(logged).toContain('- first');
    expect(logged).not.toContain('newer');
    expect(logged).not.toContain('old');
  });

  it('does nothing when the tag already points at HEAD', () => {
    const result = run(git(work, 'rev-parse', 'HEAD'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('already exists');
    expect(ghCalls()).not.toContain('git/refs ');
    expect(ghCalls()).not.toContain('release create');
  });

  it('fails when the tag points at another commit', () => {
    const result = run('0'.repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not at');
    expect(ghCalls()).not.toContain('git/refs ');
  });
});
