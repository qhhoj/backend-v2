import { join, resolve } from 'node:path';
import type { Env } from '../env/env';
import { StorageService } from './storage.service';

describe('StorageService.absolutePathOf', () => {
  const root = resolve('/tmp/qhhoj-media-path-spec');
  const storage = new StorageService({
    mediaRoot: root,
    mediaUrl: 'http://x/media',
  } as Env);

  it('resolves inside the media root and refuses to leave it', () => {
    expect(storage.absolutePathOf('materials/p1/notes.txt')).toBe(
      join(root, 'materials', 'p1', 'notes.txt'),
    );
    expect(() => storage.absolutePathOf('../outside')).toThrow(
      'escapes MEDIA_ROOT',
    );
  });
});
