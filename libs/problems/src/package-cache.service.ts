import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { assertRealPathInside, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { PACKAGE_CACHE_MAX_BYTES } from './lifecycle-queues';

const KEY_PATTERN = /^\d+\.[0-9a-f]{12}$/;
/** An error the caller treats as "already gone": ENOENT becomes `fallback`, anything else is rethrown. */
const ignoreMissing =
  <T>(fallback: T) =>
  (error: NodeJS.ErrnoException): T => {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  };

/** A temporary file this old is the debris of a crashed build. */
const STRAY_TEMPORARY_MS = 60 * 60 * 1000;

/** `<PDF_CACHE_ROOT>/packages/<code>.<key>.zip`, written by the worker and served by the api. Only the newest key of a problem is kept; a code rename or a purge drops them all. */
@Injectable()
export class PackageCacheService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.pdfCacheRoot, 'packages');
  }

  pathOf(code: string, key: string): string {
    this.assertCode(code);
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid package key: ${key}`);
    return this.resolveInside(`${code}.${key}.zip`);
  }

  async has(code: string, key: string): Promise<boolean> {
    const path = this.pathOf(code, key);
    await assertRealPathInside(this.root, path);
    const present = await access(path).then(
      () => true,
      () => false,
    );
    if (present) await this.touch(path);
    return present;
  }

  /** The cached file opened for reading (caller closes it), or null; holding the handle means a later deletion cannot break a response that already started. */
  async open(code: string, key: string): Promise<FileHandle | null> {
    const path = this.pathOf(code, key);
    await assertRealPathInside(this.root, path);
    const handle = await open(path, 'r').catch(ignoreMissing(null));
    if (handle) await this.touch(path);
    return handle;
  }

  /** `produce` writes the zip to a temporary path; it is renamed into place only when it resolves, then the problem's other keys are removed. */
  async write(
    code: string,
    key: string,
    produce: (temporaryPath: string) => Promise<void>,
  ): Promise<void> {
    const target = this.pathOf(code, key);
    await mkdir(this.root, { recursive: true });
    await assertRealPathInside(this.root, target);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await produce(temporary);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await this.deleteAll(code, key);
    await this.evictToLimit(PACKAGE_CACHE_MAX_BYTES);
  }

  /** Total cache cap (preflight M10): the oldest zips go first until the cache holds at most `maxBytes`; returns how many went. */
  async evictToLimit(maxBytes: number): Promise<number> {
    const zips: Array<{ name: string; size: number; mtimeMs: number }> = [];
    for (const name of await this.names()) {
      if (!name.endsWith('.zip')) continue;
      const found = await stat(this.resolveInside(name)).catch(
        ignoreMissing(null),
      );
      if (found) zips.push({ name, size: found.size, mtimeMs: found.mtimeMs });
    }
    zips.sort((first, second) => first.mtimeMs - second.mtimeMs);
    let total = zips.reduce((sum, zip) => sum + zip.size, 0);
    let removed = 0;
    for (const zip of zips) {
      if (total <= maxBytes) break;
      await rm(this.resolveInside(zip.name), { force: true });
      total -= zip.size;
      removed += 1;
    }
    return removed;
  }

  /** Every zip of the problem except the one under `keep`. */
  async deleteAll(code: string, keep?: string): Promise<void> {
    this.assertCode(code);
    const kept = keep === undefined ? null : `${code}.${keep}.zip`;
    for (const name of await this.names())
      if (name.startsWith(`${code}.`) && name.endsWith('.zip') && name !== kept)
        await rm(this.resolveInside(name), { force: true });
  }

  /** Zips older than `maxAgeMs` (the daily sweep) and stray temporary files; returns how many zips went. */
  async deleteOlderThan(maxAgeMs: number, now = Date.now()): Promise<number> {
    let removed = 0;
    for (const name of await this.names()) {
      const isZip = name.endsWith('.zip');
      if (!isZip && !name.endsWith('.tmp')) continue;
      const path = this.resolveInside(name);
      const found = await stat(path).catch(ignoreMissing(null));
      if (!found) continue;
      const { mtimeMs } = found;
      const limit = isZip ? maxAgeMs : STRAY_TEMPORARY_MS;
      if (now - mtimeMs <= limit) continue;
      await rm(path, { force: true });
      if (isZip) removed += 1;
    }
    return removed;
  }

  /** A hit counts as use: the newest mtime is the last one evicted. A file deleted meanwhile is not an error. */
  private async touch(path: string): Promise<void> {
    const now = new Date();
    await utimes(path, now, now).catch(ignoreMissing(undefined));
  }

  private async names(): Promise<string[]> {
    return readdir(this.root).catch(ignoreMissing([]));
  }

  private assertCode(code: string): void {
    if (!PROBLEM_CODE_PATTERN.test(code))
      throw new Error(`Invalid problem code: ${code}`);
  }

  private resolveInside(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep))
      throw new Error(`Path escapes the package cache: ${relativePath}`);
    return target;
  }
}
