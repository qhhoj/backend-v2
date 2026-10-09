import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
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

  it('maps code and key to <root>/packages/<code>.<key>.zip and refuses bad ones', () => {
    expect(cache.pathOf('sum', KEY_A)).toBe(join(packages, `sum.${KEY_A}.zip`));
    expect(() => cache.pathOf('../x', KEY_A)).toThrow('Invalid problem code');
    expect(() => cache.pathOf('sum', '../../etc')).toThrow(
      'Invalid package key',
    );
    expect(() => cache.pathOf('sum', '3.XYZ')).toThrow('Invalid package key');
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

  it('evicts the oldest zips first until the cache fits the byte limit', async () => {
    const small = mkdtempSync(join(tmpdir(), 'qhhoj-package-evict-'));
    const bounded = new PackageCacheService({ pdfCacheRoot: small } as Env);
    for (const code of ['ev_a', 'ev_b', 'ev_c'])
      await bounded.write(code, KEY_A, (temporary) =>
        Promise.resolve(writeFileSync(temporary, '12345')),
      );
    const days = (count: number) => new Date(Date.now() - count * 86_400_000);
    utimesSync(bounded.pathOf('ev_a', KEY_A), days(3), days(3));
    utimesSync(bounded.pathOf('ev_b', KEY_A), days(2), days(2));
    expect(await bounded.evictToLimit(10)).toBe(1);
    expect(await bounded.has('ev_a', KEY_A)).toBe(false);
    expect(await bounded.has('ev_b', KEY_A)).toBe(true);
    expect(await bounded.has('ev_c', KEY_A)).toBe(true);
    rmSync(small, { recursive: true, force: true });
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
});
