import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@libs/common';
import { PdfCacheService } from './pdf-cache.service';

describe('PdfCacheService', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-pdf-cache-'));
  const cache = new PdfCacheService({ pdfCacheRoot: root } as Env);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('maps code and language to <root>/<code>.<lang>.pdf and refuses bad codes', () => {
    expect(cache.pathOf('sum', 'vi')).toBe(join(root, 'sum.vi.pdf'));
    expect(() => cache.pathOf('../x', 'en')).toThrow('Invalid problem code');
    expect(() => cache.pathOf('Sum', 'en')).toThrow('Invalid problem code');
  });
  it('writes through a temp file, reports existence and deletes every language at once', async () => {
    await cache.write('sum', 'en', (temporary) =>
      Promise.resolve(writeFileSync(temporary, '%PDF-1.4')),
    );
    writeFileSync(cache.pathOf('sum', 'vi'), '%PDF-1.4');
    expect(await cache.exists('sum', 'en')).toBe(true);
    expect(readFileSync(cache.pathOf('sum', 'en'), 'utf8')).toBe('%PDF-1.4');
    await cache.delete('sum');
    expect(await cache.exists('sum', 'en')).toBe(false);
    expect(await cache.exists('sum', 'vi')).toBe(false);
    await cache.delete('sum');
  });
  it('leaves nothing behind when producing the file fails', async () => {
    await expect(
      cache.write('bad', 'en', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(existsSync(cache.pathOf('bad', 'en'))).toBe(false);
  });
  it('hands out scratch paths under .tmp', async () => {
    const scratch = await cache.scratchPath('sum.en.html');
    expect(scratch).toBe(join(root, '.tmp', 'sum.en.html'));
    expect(existsSync(join(root, '.tmp'))).toBe(true);
  });
  it.each(['../x', 'a/b', '', '.hidden', 'a..b'])(
    'refuses the scratch name %j',
    (name) =>
      expect(cache.scratchPath(name)).rejects.toThrow(
        'Unsafe scratch file name',
      ),
  );
  it('refuses a language outside the statement languages', () =>
    expect(() => cache.pathOf('sum', '../x' as 'en')).toThrow(
      'Invalid statement language',
    ));
  it('refuses a scratch directory that is a symlink to outside the root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-outside-'));
    rmSync(join(root, '.tmp'), { recursive: true, force: true });
    symlinkSync(outside, join(root, '.tmp'));
    await expect(cache.scratchPath('x.html')).rejects.toThrow('symlink');
    expect(readdirSync(outside)).toEqual([]);
    rmSync(join(root, '.tmp'));
    rmSync(outside, { recursive: true, force: true });
  });
});
