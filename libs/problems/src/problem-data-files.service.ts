import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type Redis from 'ioredis';
import {
  assertRealPathInside,
  ENV,
  REDIS,
  SAFE_SEGMENT,
  withRedisLock,
  writeFileAtomically,
} from '@libs/common';
import type { Env } from '@libs/common';
import { PROBLEM_CODE_PATTERN } from '@libs/database';

export const INIT_FILE = 'init.yml';
/** The judge's cache key for `<code>/`: the problem's `dataVersion`, written last. Dot-prefixed, so no client file (`safeName`) can take the name. */
export const DATA_VERSION_FILE = '.data-version';
/** judge-v2 waits while this exists: up before the first file change of a data write, down after the stamp. */
export const DATA_WRITING_MARKER = '.data-version.writing';
const IMPORTS_DIRECTORY = '.imports';
/** Dot-prefixed: `safeName` refuses leading dots, so no client file can ever be named like a staged upload. */
const UPLOAD_PREFIX = '.upload-';
/** Covers the largest upload plus its recompile; the lock is not renewed, so a write must finish within it. */
const DATA_WRITE_LOCK_SECONDS = 15 * 60;
const STALE_UPLOAD_MS = 60 * 60 * 1000;
/** The worker removes a package when its job ends; one left past a failed job's retention (a day) belongs to a lost job. */
const STALE_IMPORT_MS = 2 * 24 * 60 * 60 * 1000;

/** `<PROBLEM_DATA_ROOT>/<code>/` is the judge contract: init.yml, the archive and the checker/grader sources, all flat single segments. */
@Injectable()
export class ProblemDataFilesService {
  private readonly root: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.root = resolve(env.problemDataRoot);
  }

  /** Only real problem codes name a directory, so `.imports` and path tricks never reach one. */
  directoryOf(code: string): string {
    if (!PROBLEM_CODE_PATTERN.test(code))
      throw new Error(`Invalid problem code: ${code}`);
    return this.resolveInside(code);
  }

  /** Client names never reach the volume unsanitised: one safe segment, no `..`. */
  pathOf(code: string, name: string): string {
    return this.resolveInside(`${this.codeOf(code)}/${this.safeName(name)}`);
  }

  async exists(code: string, name?: string): Promise<boolean> {
    const path =
      name === undefined ? this.directoryOf(code) : this.pathOf(code, name);
    await assertRealPathInside(this.root, path);
    return access(path).then(
      () => true,
      () => false,
    );
  }

  writeFile(
    code: string,
    name: string,
    content: Buffer | Readable,
  ): Promise<void> {
    return writeFileAtomically(this.pathOf(code, name), content, this.root);
  }

  async removeFile(code: string, name: string): Promise<void> {
    const path = this.pathOf(code, name);
    await assertRealPathInside(this.root, path);
    await rm(path, { force: true });
  }

  writeInit(code: string, yamlText: string): Promise<void> {
    return this.writeFile(code, INIT_FILE, Buffer.from(yamlText, 'utf8'));
  }

  removeInit(code: string): Promise<void> {
    return this.removeFile(code, INIT_FILE);
  }

  /** Runs one data change under the problem's cross-process lock (api and worker both write data) and the judge's marker; the marker is removed on success and on every error path. A writer that finds the lock taken gets the 409 `busy` conflict at once. */
  withDataWrite<T>(code: string, work: () => Promise<T>): Promise<T> {
    const marker = this.markerPath(code);
    return withRedisLock(
      this.redis,
      {
        key: this.lockKey(code),
        ttlSeconds: DATA_WRITE_LOCK_SECONDS,
        busyMessage:
          "Another change to this problem's data is in progress, try again",
      },
      async () => {
        await writeFileAtomically(marker, Buffer.alloc(0), this.root);
        try {
          return await work();
        } finally {
          await rm(marker, { force: true });
        }
      },
    );
  }

  /** Written atomically after every other file of a data change (init.yml, committed uploads, removals), so a judge that reads version N sees N's files; a judge that sees an older stamp waits for the newer one. Never lowers the stamp; callers hold the data lock, so the read-compare-rename does not interleave. */
  async writeDataVersion(code: string, version: number): Promise<void> {
    const current = await this.readDataVersion(code);
    if (current !== null && current >= version) return;
    await writeFileAtomically(
      this.dataVersionPath(code),
      Buffer.from(`${version}\n`, 'utf8'),
      this.root,
    );
  }

  /** The stamped version, or null when the directory has none (legacy rsync data) or the stamp is not a number. */
  async readDataVersion(code: string): Promise<number | null> {
    const path = this.dataVersionPath(code);
    await assertRealPathInside(this.root, path);
    try {
      const version = Number((await readFile(path, 'utf8')).trim());
      return Number.isSafeInteger(version) ? version : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private lockKey(code: string): string {
    return `problem-data-lock:${code}`;
  }

  private markerPath(code: string): string {
    return this.resolveInside(`${this.codeOf(code)}/${DATA_WRITING_MARKER}`);
  }

  private dataVersionPath(code: string): string {
    return this.resolveInside(`${this.codeOf(code)}/${DATA_VERSION_FILE}`);
  }

  async readInit(code: string): Promise<string | null> {
    const path = this.pathOf(code, INIT_FILE);
    await assertRealPathInside(this.root, path);
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Drops a directory a failed import created for nothing; one that holds anything stays. */
  async removeDirectoryIfEmpty(code: string): Promise<void> {
    const directory = this.directoryOf(code);
    await assertRealPathInside(this.root, directory);
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
  }

  /** Drops a problem's whole directory (the purge) under the data lock and the judges' writing marker, so no upload or judge read interleaves; a missing directory is nothing to do. A symlinked directory is refused even when it points inside the root: the marker would be written into, and left on, the link's target. */
  async removeDirectory(code: string): Promise<void> {
    const directory = this.directoryOf(code);
    if ((await lstat(directory).catch(() => null))?.isSymbolicLink())
      throw new Error(`Data directory is a symlink: ${code}`);
    await this.withDataWrite(code, async () => {
      await assertRealPathInside(this.root, directory);
      await rm(directory, { recursive: true, force: true });
    });
  }

  /** Bytes of the regular files directly in the problem's data directory (staged `.upload-*` files and subdirectories do not count); 0 when the directory is missing. */
  async bytesOf(code: string): Promise<number> {
    const directory = this.directoryOf(code);
    await assertRealPathInside(this.root, directory);
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    const sizes = await Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && !entry.name.startsWith(UPLOAD_PREFIX),
        )
        .map(
          async (entry) => (await lstat(resolve(directory, entry.name))).size,
        ),
    );
    return sizes.reduce((total, size) => total + size, 0);
  }

  /** Moves a problem's whole directory; the target is reserved first so an existing one is never merged into, and a missing source is nothing to move. */
  async rename(oldCode: string, newCode: string): Promise<void> {
    const oldDirectory = this.directoryOf(oldCode);
    const newDirectory = this.directoryOf(newCode);
    await mkdir(this.root, { recursive: true });
    await assertRealPathInside(this.root, oldDirectory);
    try {
      await mkdir(newDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`Data directory already exists: ${newCode}`);
      throw error;
    }
    try {
      await rename(oldDirectory, newDirectory);
    } catch (error) {
      await rmdir(newDirectory);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** A fresh temporary path inside the problem directory, for streaming uploads before they are validated. */
  async stageUpload(code: string): Promise<string> {
    await mkdir(this.directoryOf(code), { recursive: true });
    const stagedPath = this.resolveInside(
      `${this.codeOf(code)}/${UPLOAD_PREFIX}${randomUUID()}`,
    );
    await assertRealPathInside(this.root, stagedPath);
    await this.sweepStaleUploads(code);
    return stagedPath;
  }

  /** Staged files left by a crashed request, and a writing marker whose lock is gone (its process was killed): dropped once an hour old, so abandoned uploads never pile up and no problem waits on a dead marker. */
  private async sweepStaleUploads(code: string): Promise<void> {
    const directory = this.directoryOf(code);
    const oldest = Date.now() - STALE_UPLOAD_MS;
    const locked = (await this.redis.exists(this.lockKey(code))) === 1;
    for (const entry of await readdir(directory)) {
      const staleMarker = entry === DATA_WRITING_MARKER && !locked;
      if (!entry.startsWith(UPLOAD_PREFIX) && !staleMarker) continue;
      const path = this.resolveInside(`${code}/${entry}`);
      const stats = await lstat(path).catch(() => null);
      if (stats?.isFile() && stats.mtimeMs < oldest)
        await rm(path, { force: true });
    }
  }

  /** Only a regular file at a path handed out by `stageUpload` for this code can be committed. */
  async commitUpload(
    code: string,
    stagedPath: string,
    name: string,
  ): Promise<void> {
    const staged = basename(stagedPath);
    if (
      dirname(stagedPath) !== this.directoryOf(code) ||
      !staged.startsWith(UPLOAD_PREFIX) ||
      !(await lstat(stagedPath)).isFile()
    )
      throw new Error(`Not a staged upload of ${code}: ${stagedPath}`);
    const target = this.pathOf(code, name);
    await assertRealPathInside(this.root, target);
    await rename(stagedPath, target);
  }

  /** Where the package of import job `jobId` lives: the api writes it there and the worker, which is given only the job id, reads it from the same place. */
  importPackagePathOf(jobId: string): string {
    return this.resolveInside(
      `${IMPORTS_DIRECTORY}/${this.safeName(jobId)}.zip`,
    );
  }

  /** Uploaded Polygon packages wait here for the worker; the api streams straight into this path. Packages of lost jobs are swept on the way. */
  async importPackagePath(jobId: string): Promise<string> {
    const path = this.importPackagePathOf(jobId);
    await mkdir(dirname(path), { recursive: true });
    await assertRealPathInside(this.root, path);
    await this.sweepStaleImports(dirname(path));
    return path;
  }

  private async sweepStaleImports(directory: string): Promise<void> {
    const oldest = Date.now() - STALE_IMPORT_MS;
    for (const entry of await readdir(directory)) {
      const path = resolve(directory, entry);
      const stats = await lstat(path).catch(() => null);
      if (stats?.isFile() && stats.mtimeMs < oldest)
        await rm(path, { force: true }).catch(() => undefined);
    }
  }

  private codeOf(code: string): string {
    this.directoryOf(code);
    return code;
  }

  private safeName(name: string): string {
    if (!SAFE_SEGMENT.test(name) || name.includes('..'))
      throw new Error(`Unsafe data file name: ${name}`);
    return name;
  }

  private resolveInside(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep))
      throw new Error(`Path escapes PROBLEM_DATA_ROOT: ${relativePath}`);
    return target;
  }
}
