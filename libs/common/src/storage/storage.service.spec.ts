import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
});
