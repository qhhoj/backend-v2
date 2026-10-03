import { Inject, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
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

  async save(relativePath: string, content: Buffer): Promise<string> {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep))
      throw new Error(`Path escapes MEDIA_ROOT: ${relativePath}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    return this.publicUrl(relativePath);
  }

  publicUrl(relativePath: string): string {
    return `${this.urlBase}/${relativePath}`;
  }
}
