import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../env/env';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-storage-'));
  const storage = new StorageService({
    mediaRoot: root,
    mediaUrl: '/media',
  } as Env);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes under MEDIA_ROOT, creating directories, and returns the public url', async () => {
    expect(
      await storage.save('materials/sum/data.zip', Buffer.from('zip')),
    ).toBe('/media/materials/sum/data.zip');
    expect(
      readFileSync(join(root, 'materials', 'sum', 'data.zip'), 'utf8'),
    ).toBe('zip');
  });
  it('refuses paths that escape the root', async () => {
    await expect(
      storage.save('../outside.txt', Buffer.from('x')),
    ).rejects.toThrow('Path escapes MEDIA_ROOT');
    await expect(storage.save('/etc/passwd', Buffer.from('x'))).rejects.toThrow(
      'Path escapes MEDIA_ROOT',
    );
    await expect(storage.save('.', Buffer.from('x'))).rejects.toThrow(
      'Path escapes MEDIA_ROOT',
    );
  });
  it('leaves no temp file behind and overwrites atomically', async () => {
    await storage.save('pdf/a.pdf', Buffer.from('one'));
    await storage.save('pdf/a.pdf', Buffer.from('two'));
    expect(readdirSync(join(root, 'pdf'))).toEqual(['a.pdf']);
    expect(readFileSync(join(root, 'pdf', 'a.pdf'), 'utf8')).toBe('two');
  });
  it('deletes files, tolerates missing ones and refuses to escape', async () => {
    await storage.save('pdf/b.pdf', Buffer.from('x'));
    await storage.delete('pdf/b.pdf');
    expect(existsSync(join(root, 'pdf', 'b.pdf'))).toBe(false);
    await storage.delete('pdf/b.pdf');
    await expect(storage.delete('../x')).rejects.toThrow(
      'Path escapes MEDIA_ROOT',
    );
  });
  it('refuses to delete through a directory symlink that leaves the root, and keeps the outside file', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-outside-'));
    writeFileSync(join(outside, 'data.zip'), 'keep');
    mkdirSync(join(root, 'materials'), { recursive: true });
    symlinkSync(outside, join(root, 'materials', 'linked'));
    await expect(storage.delete('materials/linked/data.zip')).rejects.toThrow(
      'through a symlink',
    );
    expect(readFileSync(join(outside, 'data.zip'), 'utf8')).toBe('keep');
    rmSync(outside, { recursive: true, force: true });
  });
  it('deletes a symlinked file by removing the link, never its target', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-outside-'));
    writeFileSync(join(outside, 'shared.pdf'), 'keep');
    mkdirSync(join(root, 'pdf'), { recursive: true });
    symlinkSync(join(outside, 'shared.pdf'), join(root, 'pdf', 'link.pdf'));
    await storage.delete('pdf/link.pdf');
    expect(existsSync(join(root, 'pdf', 'link.pdf'))).toBe(false);
    expect(readFileSync(join(outside, 'shared.pdf'), 'utf8')).toBe('keep');
    rmSync(outside, { recursive: true, force: true });
  });
  it.each([
    ['/media/pdf/a.pdf', 'pdf', 'pdf/a.pdf'],
    ['/media/materials/sum/data.zip', 'materials', 'materials/sum/data.zip'],
    ['/media/materials/sum/data.zip', 'pdf', null],
    ['/media/pdf/a.pdf', 'materials', null],
    ['/media/images/a.png', 'pdf', null],
    ['/media/pdf/../x', 'pdf', null],
    ['/media/pdf/a/b', 'pdf', null],
    ['/media/pdf/.hidden', 'pdf', null],
    ['/media/materials/sum/../../images/x.png', 'materials', null],
    ['/media/materials/sum', 'materials', null],
    ['https://evil/media/pdf/a.pdf', 'pdf', null],
    [null, 'pdf', null],
  ] as const)('maps %s as %s to %s', (url, kind, expected) =>
    expect(storage.relativePathOf(url, kind)).toBe(expected),
  );
});
