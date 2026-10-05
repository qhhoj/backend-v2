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
const IMPORTS_DIRECTORY = '.imports';
/** Dot-prefixed: `safeName` refuses leading dots, so no client file can ever be named like a staged upload. */
const UPLOAD_PREFIX = '.upload-';
const STALE_UPLOAD_MS = 60 * 60 * 1000;

/** `<PROBLEM_DATA_ROOT>/<code>/` is the judge contract: init.yml, the archive and the checker/grader sources, all flat single segments. */
@Injectable()
export class ProblemDataFilesService {
  private readonly root: string;

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

  /** Staged files left by a crashed request: dropped once an hour old, so abandoned uploads never pile up. */
  private async sweepStaleUploads(code: string): Promise<void> {
    const directory = this.directoryOf(code);
    const oldest = Date.now() - STALE_UPLOAD_MS;
    for (const entry of await readdir(directory)) {
      if (!entry.startsWith(UPLOAD_PREFIX)) continue;
      const path = this.resolveInside(`${code}/${entry}`);
      const stats = await lstat(path).catch(() => null);
      if (stats && stats.mtimeMs < oldest) await rm(path, { force: true });
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

  /** Uploaded Polygon packages wait here for the worker; the api streams straight into this path. */
  async importPackagePath(jobId: string): Promise<string> {
    const path = this.resolveInside(
      `${IMPORTS_DIRECTORY}/${this.safeName(jobId)}.zip`,
    );
    await mkdir(dirname(path), { recursive: true });
    await assertRealPathInside(this.root, path);
    return path;
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
