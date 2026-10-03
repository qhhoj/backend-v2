import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ENV, type Env } from '../env/env';

const SAFE_SEGMENT = /^[\w-][\w.-]*$/;

/** Files on the local media volume (statement images, PDF statements, materials); nginx serves MEDIA_ROOT at MEDIA_URL. */
@Injectable()
export class StorageService {
  private readonly root: string;
  private readonly urlBase: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.mediaRoot);
    this.urlBase = env.mediaUrl;
  }

  /** Written to a temp name then renamed, so readers never see a partial file. */
  async save(relativePath: string, content: Buffer): Promise<string> {
    const target = this.resolveInside(relativePath);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return this.publicUrl(relativePath);
  }

  async delete(relativePath: string): Promise<void> {
    await rm(this.resolveInside(relativePath), { force: true });
  }

  /** Relative path of a url this service produced, only if it is exactly `pdf/<name>` (kind `pdf`) or `materials/<code>/<name>` (kind `materials`) with safe single segments; else null. */
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

  publicUrl(relativePath: string): string {
    return `${this.urlBase}/${relativePath}`;
  }

  private resolveInside(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep))
      throw new Error(`Path escapes MEDIA_ROOT: ${relativePath}`);
    return target;
  }
}
