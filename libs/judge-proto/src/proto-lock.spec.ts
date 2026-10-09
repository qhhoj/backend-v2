import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LIB = resolve(__dirname, '..');
const LOCK_SCRIPT = resolve(
  LIB,
  '..',
  '..',
  'scripts',
  'judge-proto',
  'lock.js',
);

const checkLock = (lib: string) =>
  spawnSync('node', [LOCK_SCRIPT, 'check'], {
    env: { ...process.env, JUDGE_PROTO_LIB: lib },
    encoding: 'utf8',
  });

describe('vendored judge-v2 proto', () => {
  it('matches the hashes in proto.lock.json', () => {
    const result = checkLock(LIB);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('names a vendored file edited by hand', () => {
    const copy = mkdtempSync(join(tmpdir(), 'judge-proto-lock-'));
    try {
      cpSync(join(LIB, 'proto'), join(copy, 'proto'), { recursive: true });
      cpSync(join(LIB, 'proto.lock.json'), join(copy, 'proto.lock.json'));
      appendFileSync(
        join(copy, 'proto', 'qhhoj', 'judge', 'v1', 'judge.proto'),
        '// edited\n',
      );
      const result = checkLock(copy);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('qhhoj/judge/v1/judge.proto');
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
