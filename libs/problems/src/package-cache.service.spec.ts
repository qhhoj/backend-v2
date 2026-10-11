import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@libs/common';
import { PackageCacheService } from './package-cache.service';

describe('PackageCacheService', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-package-cache-'));
  const cache = new PackageCacheService({ pdfCacheRoot: root } as Env);
  const packages = join(root, 'packages');
  const KEY_A = '3.aaaaaaaaaaaa';
  const KEY_B = '4.bbbbbbbbbbbb';
  const put = (code: string, key: string, content = 'zip') =>
    cache.write(code, key, (temporary) =>
      Promise.resolve(writeFileSync(temporary, content)),
    );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('refuses a bad code or key', () => {
    expect(() => cache.pathOf('../x', KEY_A)).toThrow('Invalid problem code');
    expect(() => cache.pathOf('sum', '../../etc')).toThrow(
      'Invalid package key',
    );
  });

  it('writes through a temporary file, serves it, and keeps only the newest key', async () => {
    await put('keep', KEY_A, 'old');
    expect(await cache.has('keep', KEY_A)).toBe(true);
    await put('keep', KEY_B, 'new');
    expect(await cache.has('keep', KEY_A)).toBe(false);
    const handle = await cache.open('keep', KEY_B);
    expect((await handle?.readFile('utf8')) ?? '').toBe('new');
    await handle?.close();
    expect(await cache.open('keep', KEY_A)).toBeNull();
  });

  it('leaves nothing behind when producing the file fails', async () => {
    await expect(
      cache.write('bad', KEY_A, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(
      readdirSync(packages).filter((name) => name.startsWith('bad.')),
    ).toEqual([]);
  });

  it('deletes every zip of one code and no other code, even a prefix of it', async () => {
    await put('del', KEY_A);
    await put('del_more', KEY_A);
    await cache.deleteAll('del');
    expect(existsSync(cache.pathOf('del', KEY_A))).toBe(false);
    expect(existsSync(cache.pathOf('del_more', KEY_A))).toBe(true);
  });

  it('sweeps zips and stray temporary files older than the limit', async () => {
    await put('old', KEY_A);
    await put('fresh', KEY_A);
    const stale = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(cache.pathOf('old', KEY_A), stale, stale);
    writeFileSync(join(packages, 'old.x.tmp'), 'partial');
    utimesSync(join(packages, 'old.x.tmp'), stale, stale);
    expect(await cache.deleteOlderThan(3_600_000)).toBe(1);
    expect(existsSync(cache.pathOf('old', KEY_A))).toBe(false);
    expect(existsSync(join(packages, 'old.x.tmp'))).toBe(false);
    expect(existsSync(cache.pathOf('fresh', KEY_A))).toBe(true);
  });

  /** A name `readdir` listed that another process deleted before `stat` ran. */
  const listingWith = (ghost: string, real: string[]) =>
    jest
      .spyOn(cache as unknown as { names(): Promise<string[]> }, 'names')
      .mockResolvedValue([ghost, ...real]);

  it('treats a zip that vanished during a sweep or an eviction as already gone', async () => {
    await put('race', KEY_A);
    const spy = listingWith(`ghost.${KEY_A}.zip`, [`race.${KEY_A}.zip`]);
    try {
      await expect(cache.evictToLimit(0)).resolves.toBe(1);
      await put('race2', KEY_A);
      spy.mockResolvedValue([`ghost.${KEY_A}.zip`, `race2.${KEY_A}.zip`]);
      await expect(cache.deleteOlderThan(-1)).resolves.toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(cache.pathOf('race', KEY_A))).toBe(false);
    expect(existsSync(cache.pathOf('race2', KEY_A))).toBe(false);
  });

  it('counts a cache hit as use, so the least recently used zip is evicted first', async () => {
    const small = mkdtempSync(join(tmpdir(), 'qhhoj-package-lru-'));
    const bounded = new PackageCacheService({ pdfCacheRoot: small } as Env);
    for (const code of ['lru_a', 'lru_b'])
      await bounded.write(code, KEY_A, (temporary) =>
        Promise.resolve(writeFileSync(temporary, '12345')),
      );
    const days = (count: number) => new Date(Date.now() - count * 86_400_000);
    utimesSync(bounded.pathOf('lru_a', KEY_A), days(3), days(3));
    utimesSync(bounded.pathOf('lru_b', KEY_A), days(2), days(2));
    await (await bounded.open('lru_a', KEY_A))?.close();
    expect(await bounded.evictToLimit(5)).toBe(1);
    expect(existsSync(bounded.pathOf('lru_a', KEY_A))).toBe(true);
    expect(existsSync(bounded.pathOf('lru_b', KEY_A))).toBe(false);
    rmSync(small, { recursive: true, force: true });
  });

  it('refuses a cached zip that is a symlink out of the cache', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-package-outside-'));
    mkdirSync(packages, { recursive: true });
    symlinkSync(outside, join(packages, `link.${KEY_A}.zip`));
    await expect(cache.open('link', KEY_A)).rejects.toThrow('symlink');
    await expect(cache.has('link', KEY_A)).rejects.toThrow('symlink');
    rmSync(outside, { recursive: true, force: true });
  });
});
