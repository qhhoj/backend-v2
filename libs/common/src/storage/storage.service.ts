import { Inject, Injectable } from '@nestjs/common';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ENV, type Env } from '../env/env';
import { assertRealPathInside, writeFileAtomically } from './atomic-write';

export const SAFE_SEGMENT = /^[\w-][\w.-]*$/;

/** Files on the local media volume (statement images, PDF statements, materials); nginx serves MEDIA_ROOT at MEDIA_URL. */
@Injectable()
export class StorageService {
  private readonly root: string;
  private readonly urlBase: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.mediaRoot);
    this.urlBase = env.mediaUrl;
  }

  async save(relativePath: string, content: Buffer): Promise<string> {
    await writeFileAtomically(
      this.resolveInside(relativePath),
      content,
      this.root,
    );
    return this.publicUrl(relativePath);
  }

  /** Copies a stored file to a new path and returns the new url. */
  async copy(fromPath: string, toPath: string): Promise<string> {
    return this.save(toPath, await readFile(this.resolveInside(fromPath)));
  }

  /** Refuses a path whose directory resolves outside MEDIA_ROOT through a symlink (an rsync'd legacy tree may hold one), so `rm` never reaches a file outside the root; a symlinked file itself is fine, `rm` removes only the link. */
  async delete(relativePath: string): Promise<void> {
    const target = this.resolveInside(relativePath);
    await assertRealPathInside(this.root, dirname(target));
    await rm(target, { force: true });
  }

  /** Relative path of a url this service produced, only if it is exactly `pdf/<name>` (kind `pdf`) or `materials/<problemId>/<name>` (kind `materials`) with safe single segments; else null. */
  relativePathOf(url: string | null, kind: 'pdf' | 'materials'): string | null {
    const prefix = this.publicUrl('');
    if (!url?.startsWith(prefix)) return null;
    const relativePath = url.slice(prefix.length);
    const [directory, ...names] = relativePath.split('/');
    const isLayout =
      directory === kind && names.length === (kind === 'pdf' ? 1 : 2);
    return isLayout &&
      names.every(
        (segment) => SAFE_SEGMENT.test(segment) && !segment.includes('..'),
      )
      ? relativePath
      : null;
  }

  /** Size of a stored file; 0 when it is gone. Any other disk error propagates. */
  async bytesOf(relativePath: string): Promise<number> {
    try {
      return (await stat(this.resolveInside(relativePath))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }

  publicUrl(relativePath: string): string {
    return `${this.urlBase}/${relativePath}`;
  }

  /** The absolute path of a stored file, for a reader that streams it (the package job); same escape check as every write. */
  absolutePathOf(relativePath: string): string {
    return this.resolveInside(relativePath);
  }

  private resolveInside(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep))
      throw new Error(`Path escapes MEDIA_ROOT: ${relativePath}`);
    return target;
  }
}
