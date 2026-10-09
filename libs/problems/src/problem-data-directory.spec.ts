import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import Redis from 'ioredis';
import { ProblemDataFilesService } from './problem-data-files.service';

describe('ProblemDataFilesService.removeDirectory', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-'));
  const redis = new Redis(TEST_REDIS_URL);
  const files = new ProblemDataFilesService(
    { problemDataRoot: root } as Env,
    redis,
  );
  afterAll(async () => {
    await redis.quit();
    rmSync(root, { recursive: true, force: true });
  });

  it('removes the whole directory of one code and nothing next to it', async () => {
    for (const code of ['gone', 'gone_two']) {
      mkdirSync(join(root, code), { recursive: true });
      writeFileSync(join(root, code, 'tests.zip'), 'x');
    }
    await files.removeDirectory('gone');
    expect(existsSync(join(root, 'gone'))).toBe(false);
    expect(existsSync(join(root, 'gone_two', 'tests.zip'))).toBe(true);
  });

  it('is a no-op for a missing directory and refuses a bad code', async () => {
    await expect(
      files.removeDirectory('never_existed'),
    ).resolves.toBeUndefined();
    await expect(files.removeDirectory('../x')).rejects.toThrow(
      'Invalid problem code',
    );
  });

  it('refuses while a data write holds the problem lock, and leaves the files', async () => {
    mkdirSync(join(root, 'busy'), { recursive: true });
    writeFileSync(join(root, 'busy', 'tests.zip'), 'x');
    let release!: () => void;
    const held = files.withDataWrite(
      'busy',
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(files.removeDirectory('busy')).rejects.toThrow();
    expect(existsSync(join(root, 'busy', 'tests.zip'))).toBe(true);
    release();
    await held;
    await files.removeDirectory('busy');
    expect(existsSync(join(root, 'busy'))).toBe(false);
  });

  it('removes a symlinked directory out of the root without touching its target', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-outside-'));
    writeFileSync(join(outside, 'keep.txt'), 'x');
    symlinkSync(outside, join(root, 'linked'));
    await expect(files.removeDirectory('linked')).rejects.toThrow();
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });
});
