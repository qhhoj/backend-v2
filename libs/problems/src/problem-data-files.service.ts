import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import {
  assertRealPathInside,
  ENV,
  SAFE_SEGMENT,
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
const STALE_UPLOAD_MS = 60 * 60 * 1000;
/** The worker removes a package when its job ends; one left past a failed job's retention (a day) belongs to a lost job. */
const STALE_IMPORT_MS = 2 * 24 * 60 * 60 * 1000;

/** `<PROBLEM_DATA_ROOT>/<code>/` is the judge contract: init.yml, the archive and the checker/grader sources, all flat single segments. */
@Injectable()
export class ProblemDataFilesService {
  private readonly root: string;
  /** Overlapping data writes of one problem share its marker: the last one out removes it. */
  private readonly writersOf = new Map<string, number>();
  /** Per-problem tail of the stamp writes, so a read-compare-rename never interleaves with another in this process. */
  private readonly stampTail = new Map<string, Promise<unknown>>();

  constructor(@Inject(ENV) env: Env) {
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

  /** Runs one data change under the marker; removed on success and on every error path. */
  async withDataWrite<T>(code: string, work: () => Promise<T>): Promise<T> {
    const marker = this.markerPath(code);
    const writers = this.writersOf.get(code) ?? 0;
    this.writersOf.set(code, writers + 1);
    try {
      if (writers === 0)
        await writeFileAtomically(marker, Buffer.alloc(0), this.root);
      return await work();
    } finally {
      const left = (this.writersOf.get(code) ?? 1) - 1;
      if (left > 0) this.writersOf.set(code, left);
      else {
        this.writersOf.delete(code);
        await rm(marker, { force: true });
      }
    }
  }

  /** Written atomically after every other file of a data change (init.yml, committed uploads, removals), so a judge that reads version N sees N's files; a judge that sees an older stamp waits for the newer one. Never lowers the stamp: two overlapping edits can finish out of order, and the newer version must win. */
  writeDataVersion(code: string, version: number): Promise<void> {
    const previous = this.stampTail.get(code) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.raiseDataVersion(code, version));
    this.stampTail.set(code, run);
    const forget = () => {
      if (this.stampTail.get(code) === run) this.stampTail.delete(code);
    };
    run.then(forget, forget);
    return run;
  }

  private async raiseDataVersion(code: string, version: number): Promise<void> {
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

  /** Staged files left by a crashed request, and a writing marker no live writer holds (its process was killed): dropped once an hour old, so abandoned uploads never pile up and no problem waits on a dead marker. */
  private async sweepStaleUploads(code: string): Promise<void> {
    const directory = this.directoryOf(code);
    const oldest = Date.now() - STALE_UPLOAD_MS;
    for (const entry of await readdir(directory)) {
      const staleMarker =
        entry === DATA_WRITING_MARKER && !this.writersOf.has(code);
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
