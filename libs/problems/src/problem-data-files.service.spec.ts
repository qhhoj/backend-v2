import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '@libs/common';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { ProblemDataFilesService } from './problem-data-files.service';

describe('ProblemDataFilesService', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-'));
  const env = { problemDataRoot: root } as Env;
  const redis = new Redis(TEST_REDIS_URL);
  const otherProcessRedis = new Redis(TEST_REDIS_URL);
  const files = new ProblemDataFilesService(env, redis);
  const otherProcess = new ProblemDataFilesService(env, otherProcessRedis);
  beforeAll(() => redis.flushdb());
  afterAll(async () => {
    await redis.quit();
    await otherProcessRedis.quit();
    rmSync(root, { recursive: true, force: true });
  });

  it('writes init.yml atomically under <root>/<code>/ and reads it back', async () => {
    await files.writeInit('sum', 'archive: tests.zip\n');
    expect(readFileSync(join(root, 'sum', 'init.yml'), 'utf8')).toBe(
      'archive: tests.zip\n',
    );
    expect(readdirSync(join(root, 'sum'))).toEqual(['init.yml']);
    expect(await files.readInit('sum')).toBe('archive: tests.zip\n');
    await files.removeInit('sum');
    expect(await files.readInit('sum')).toBeNull();
    await files.removeInit('sum');
  });
  it('stamps the data version atomically, replaces it, and reads none from an unstamped directory', async () => {
    expect(await files.readDataVersion('stamped')).toBeNull();
    await files.writeInit('stamped', 'archive: tests.zip\n');
    expect(await files.readDataVersion('stamped')).toBeNull();
    await files.writeDataVersion('stamped', 4);
    await files.writeDataVersion('stamped', 5);
    expect(readFileSync(join(root, 'stamped', '.data-version'), 'utf8')).toBe(
      '5\n',
    );
    expect(await files.readDataVersion('stamped')).toBe(5);
    expect(readdirSync(join(root, 'stamped')).sort()).toEqual([
      '.data-version',
      'init.yml',
    ]);
  });
  it('never lowers the stamp, even when overlapping writes finish out of order', async () => {
    await files.writeDataVersion('monotonic', 5);
    await files.writeDataVersion('monotonic', 4);
    expect(await files.readDataVersion('monotonic')).toBe(5);
  });
  it('reads a corrupt stamp as none', async () => {
    mkdirSync(join(root, 'corrupt'), { recursive: true });
    writeFileSync(join(root, 'corrupt', '.data-version'), 'oops\n');
    expect(await files.readDataVersion('corrupt')).toBeNull();
  });
  describe('writing marker', () => {
    const markerOf = (code: string) =>
      join(root, code, '.data-version.writing');
    it('is up while the change runs and gone after it, with its result returned', async () => {
      const result = await files.withDataWrite('marked', () => {
        expect(existsSync(markerOf('marked'))).toBe(true);
        return Promise.resolve(42);
      });
      expect(result).toBe(42);
      expect(existsSync(markerOf('marked'))).toBe(false);
    });
    it('is gone after the change fails', async () => {
      await expect(
        files.withDataWrite('marked', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      expect(existsSync(markerOf('marked'))).toBe(false);
    });
    it('serialises writers of one problem across independent service instances, and frees the lock after', async () => {
      let release!: () => void;
      let running!: () => void;
      const started = new Promise<void>((resolve) => (running = resolve));
      const holder = files.withDataWrite(
        'shared',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
            running();
          }),
      );
      await started;
      await expect(
        otherProcess.withDataWrite('shared', () => Promise.resolve()),
      ).rejects.toMatchObject({
        status: 409,
        code: 'conflict',
        extra: {
          issues: [expect.objectContaining({ field: 'lock', code: 'busy' })],
        },
      });
      await otherProcess.withDataWrite('free_other', () => Promise.resolve());
      expect(existsSync(markerOf('shared'))).toBe(true);
      release();
      await holder;
      expect(existsSync(markerOf('shared'))).toBe(false);
      await otherProcess.withDataWrite('shared', () => Promise.resolve());
    });
    it('is swept when stale and its lock is gone, kept when fresh or while a writer holds the lock', async () => {
      mkdirSync(join(root, 'dead'), { recursive: true });
      writeFileSync(markerOf('dead'), '');
      await files.stageUpload('dead');
      expect(existsSync(markerOf('dead'))).toBe(true);
      const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(markerOf('dead'), longAgo, longAgo);
      await files.stageUpload('dead');
      expect(existsSync(markerOf('dead'))).toBe(false);
    });
    it('is not swept from under a live writer', async () => {
      await files.withDataWrite('live', async () => {
        const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        utimesSync(markerOf('live'), longAgo, longAgo);
        await files.stageUpload('live');
        expect(existsSync(markerOf('live'))).toBe(true);
      });
    });
  });
  it('moves the stamp with a renamed directory', async () => {
    await files.writeDataVersion('before_rename', 7);
    await files.rename('before_rename', 'after_rename');
    expect(await files.readDataVersion('after_rename')).toBe(7);
  });
  it('refuses to stamp a directory that is not a problem code', async () => {
    await expect(files.writeDataVersion('../x', 1)).rejects.toThrow(
      /Invalid problem code/,
    );
  });
  it('writes buffers and streams, reports existence', async () => {
    await files.writeFile('sum', 'checker.cpp', Buffer.from('int main(){}'));
    await files.writeFile(
      'sum',
      'tests.zip',
      Readable.from([Buffer.from('PK')]),
    );
    expect(await files.exists('sum')).toBe(true);
    expect(await files.exists('sum', 'tests.zip')).toBe(true);
    expect(await files.exists('sum', 'missing.zip')).toBe(false);
    expect(await files.exists('nope')).toBe(false);
    await files.removeFile('sum', 'checker.cpp');
    expect(await files.exists('sum', 'checker.cpp')).toBe(false);
  });
  it('removes an empty problem directory and leaves one that holds a file', async () => {
    await files.stageUpload('hollow');
    await files.removeDirectoryIfEmpty('hollow');
    expect(existsSync(join(root, 'hollow'))).toBe(false);
    await files.writeFile('kept', 'tests.zip', Buffer.from('PK'));
    await files.removeDirectoryIfEmpty('kept');
    await files.removeDirectoryIfEmpty('never_existed');
    expect(readdirSync(join(root, 'kept'))).toEqual(['tests.zip']);
  });
  it.each(['../x', 'a/b', '.hidden', 'a..b', '', 'x\0y'])(
    'refuses the file name %j',
    (name) =>
      expect(() => files.pathOf('sum', name)).toThrow('Unsafe data file name'),
  );
  it.each([
    '.imports',
    'a/b',
    'Sum',
    '../etc',
    '',
    'sum/../taken',
    'x\0y',
    'a'.repeat(33),
  ])('refuses the code %j', (code) => {
    expect(() => files.directoryOf(code)).toThrow('Invalid problem code');
    expect(() => files.pathOf(code, 'init.yml')).toThrow(
      'Invalid problem code',
    );
  });
  it('keeps the import queue out of rename', async () => {
    await expect(files.rename('.imports', 'stolen')).rejects.toThrow(
      'Invalid problem code',
    );
  });
  it('refuses to rename onto an existing directory and leaves it untouched', async () => {
    await files.writeInit('keep', 'x: 1\n');
    await files.writeInit('src', 'x: 2\n');
    await expect(files.rename('src', 'keep')).rejects.toThrow(
      'Data directory already exists: keep',
    );
    expect(await files.readInit('keep')).toBe('x: 1\n');
    expect(await files.readInit('src')).toBe('x: 2\n');
  });
  it('leaves no reservation behind when the source is missing', async () => {
    await files.rename('ghost2', 'reserved');
    expect(existsSync(join(root, 'reserved'))).toBe(false);
  });
  it("refuses a staged path that is not this code's upload", async () => {
    const staged = await files.stageUpload('sum');
    await expect(
      files.commitUpload('sum', join(root, 'other', '.upload-x'), 'a.zip'),
    ).rejects.toThrow('Not a staged upload');
    await expect(
      files.commitUpload('sum', join(root, 'sum', 'init.yml'), 'a.zip'),
    ).rejects.toThrow('Not a staged upload');
    await expect(
      files.commitUpload('sum', '/etc/passwd', 'a.zip'),
    ).rejects.toThrow('Not a staged upload');
    await expect(files.commitUpload('other', staged, 'a.zip')).rejects.toThrow(
      'Not a staged upload',
    );
  });
  it('refuses to commit a staged path that is a symlink or a directory, and an unprefixed name', async () => {
    const staged = await files.stageUpload('sum');
    symlinkSync('/etc/passwd', staged);
    await expect(files.commitUpload('sum', staged, 'a.zip')).rejects.toThrow(
      'Not a staged upload',
    );
    rmSync(staged);
    mkdirSync(staged);
    await expect(files.commitUpload('sum', staged, 'a.zip')).rejects.toThrow(
      'Not a staged upload',
    );
    rmSync(staged, { recursive: true });
    writeFileSync(join(root, 'sum', 'upload-x.tmp'), 'x');
    await expect(
      files.commitUpload('sum', join(root, 'sum', 'upload-x.tmp'), 'a.zip'),
    ).rejects.toThrow('Not a staged upload');
    expect(existsSync(join(root, 'sum', 'a.zip'))).toBe(false);
  });
  it('sweeps staged uploads older than an hour and keeps fresh ones and real files', async () => {
    const directory = join(root, 'sweep');
    mkdirSync(directory);
    const old = join(directory, '.upload-old');
    const fresh = join(directory, '.upload-fresh');
    const real = join(directory, 'tests.zip');
    for (const path of [old, fresh, real]) writeFileSync(path, 'x');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    utimesSync(real, twoHoursAgo, twoHoursAgo);
    const staged = await files.stageUpload('sweep');
    expect(readdirSync(directory).sort()).toEqual([
      '.upload-fresh',
      'tests.zip',
    ]);
    expect(existsSync(staged)).toBe(false);
  });
  it('refuses a problem directory that is a symlink to outside the root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-outside-'));
    writeFileSync(join(outside, 'init.yml'), 'secret: 1\n');
    symlinkSync(outside, join(root, 'planted'));
    await expect(
      files.writeFile('planted', 'a.txt', Buffer.from('x')),
    ).rejects.toThrow('symlink');
    await expect(files.readInit('planted')).rejects.toThrow('symlink');
    await expect(files.removeInit('planted')).rejects.toThrow('symlink');
    await expect(files.exists('planted')).rejects.toThrow('symlink');
    expect(readdirSync(outside)).toEqual(['init.yml']);
    rmSync(outside, { recursive: true, force: true });
  });
  it('accepts a long safe file name', async () => {
    const name = `${'n'.repeat(225)}.zip`;
    await files.writeFile('sum', name, Buffer.from('x'));
    expect(await files.exists('sum', name)).toBe(true);
  });
  it('renames a directory, refuses an existing target and ignores a missing source', async () => {
    await files.writeInit('old', 'x: 1\n');
    await files.writeInit('taken', 'x: 2\n');
    await expect(files.rename('old', 'taken')).rejects.toThrow(
      'Data directory already exists: taken',
    );
    expect(existsSync(join(root, 'old', 'init.yml'))).toBe(true);
    await files.rename('old', 'fresh');
    expect(existsSync(join(root, 'old'))).toBe(false);
    expect(await files.readInit('fresh')).toBe('x: 1\n');
    await files.rename('ghost', 'other');
    expect(existsSync(join(root, 'other'))).toBe(false);
  });
  it('stages an upload inside the problem directory and commits it by rename', async () => {
    const staged = await files.stageUpload('sum');
    expect(staged.startsWith(join(root, 'sum') + '/.upload-')).toBe(true);
    writeFileSync(staged, 'zip bytes');
    await files.commitUpload('sum', staged, 'data.zip');
    expect(readFileSync(join(root, 'sum', 'data.zip'), 'utf8')).toBe(
      'zip bytes',
    );
    expect(existsSync(staged)).toBe(false);
  });
  it('keeps Polygon packages under .imports and refuses unsafe job ids', async () => {
    expect(
      await files.importPackagePath('0192b0e0-0000-7000-8000-000000000001'),
    ).toBe(join(root, '.imports', '0192b0e0-0000-7000-8000-000000000001.zip'));
    expect(existsSync(join(root, '.imports'))).toBe(true);
    await expect(files.importPackagePath('../x')).rejects.toThrow(
      'Unsafe data file name',
    );
  });
  it('sweeps Polygon packages of lost jobs but keeps recent ones', async () => {
    const stale = join(root, '.imports', 'lost.zip');
    const recent = join(root, '.imports', 'recent.zip');
    writeFileSync(stale, 'x');
    writeFileSync(recent, 'x');
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);
    await files.importPackagePath('0192b0e0-0000-7000-8000-000000000002');
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });
  it('still hands out a path when a stale package cannot be removed', async () => {
    const directory = join(root, '.imports');
    const stale = join(directory, 'locked.zip');
    writeFileSync(stale, 'x');
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);
    chmodSync(directory, 0o500);
    try {
      expect(
        await files.importPackagePath('0192b0e0-0000-7000-8000-000000000003'),
      ).toBe(join(directory, '0192b0e0-0000-7000-8000-000000000003.zip'));
    } finally {
      chmodSync(directory, 0o700);
    }
  });
});
