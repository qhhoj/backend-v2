import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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
  it('maps only its own urls under a prefix back to relative paths', () => {
    expect(storage.relativePathOf('/media/pdf/a.pdf', 'pdf/')).toBe(
      'pdf/a.pdf',
    );
    expect(storage.relativePathOf('/media/images/a.png', 'pdf/')).toBeNull();
    expect(
      storage.relativePathOf('https://evil/media/pdf/a.pdf', 'pdf/'),
    ).toBeNull();
    expect(storage.relativePathOf(null, 'pdf/')).toBeNull();
  });
});
