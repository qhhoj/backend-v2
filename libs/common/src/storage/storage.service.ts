import { Inject, Injectable } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { ENV, type Env } from '../env/env';
import { writeFileAtomically } from './atomic-write';

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

  async delete(relativePath: string): Promise<void> {
    await rm(this.resolveInside(relativePath), { force: true });
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
