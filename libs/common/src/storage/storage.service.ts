import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ENV, type Env } from '../env/env';

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

  /** Relative path of a url this service produced under `prefix`, else null. */
  relativePathOf(url: string | null, prefix: string): string | null {
    const base = this.publicUrl(prefix);
    return url?.startsWith(base) ? url.slice(this.publicUrl('').length) : null;
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
