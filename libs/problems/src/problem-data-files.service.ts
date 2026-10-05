import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { ENV, SAFE_SEGMENT, writeFileAtomically } from '@libs/common';
import type { Env } from '@libs/common';

export const INIT_FILE = 'init.yml';
const IMPORTS_DIRECTORY = '.imports';
const fileExists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** `<PROBLEM_DATA_ROOT>/<code>/` is the judge contract: init.yml, the archive and the checker/grader sources, all flat single segments. */
@Injectable()
export class ProblemDataFilesService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.problemDataRoot);
  }

  directoryOf(code: string): string {
    return this.resolveInside(code);
  }

  /** Client names never reach the volume unsanitised: one safe segment, no `..`. */
  pathOf(code: string, name: string): string {
    return this.resolveInside(`${code}/${this.safeName(name)}`);
  }

  exists(code: string, name?: string): Promise<boolean> {
    return fileExists(
      name === undefined ? this.directoryOf(code) : this.pathOf(code, name),
    );
  }

  writeFile(
    code: string,
    name: string,
    content: Buffer | Readable,
  ): Promise<void> {
    return writeFileAtomically(this.pathOf(code, name), content);
  }

  async removeFile(code: string, name: string): Promise<void> {
    await rm(this.pathOf(code, name), { force: true });
  }

  writeInit(code: string, yamlText: string): Promise<void> {
    return this.writeFile(code, INIT_FILE, Buffer.from(yamlText, 'utf8'));
  }

  removeInit(code: string): Promise<void> {
    return this.removeFile(code, INIT_FILE);
  }

  async readInit(code: string): Promise<string | null> {
    try {
      return await readFile(this.pathOf(code, INIT_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Moves a problem's whole directory; an existing target is never merged into, a missing source is nothing to move. */
  async rename(oldCode: string, newCode: string): Promise<void> {
    if (await this.exists(newCode))
      throw new Error(`Data directory already exists: ${newCode}`);
    if (await this.exists(oldCode))
      await rename(this.directoryOf(oldCode), this.directoryOf(newCode));
  }

  /** A fresh temporary path inside the problem directory, for streaming uploads before they are validated. */
  async stageUpload(code: string): Promise<string> {
    await mkdir(this.directoryOf(code), { recursive: true });
    return this.pathOf(code, `upload-${randomUUID()}.tmp`);
  }

  async commitUpload(
    code: string,
    stagedPath: string,
    name: string,
  ): Promise<void> {
    await rename(stagedPath, this.pathOf(code, name));
  }

  /** Uploaded Polygon packages wait here for the worker; the api streams straight into this path. */
  async importPackagePath(jobId: string): Promise<string> {
    const path = this.resolveInside(
      `${IMPORTS_DIRECTORY}/${this.safeName(jobId)}.zip`,
    );
    await mkdir(this.resolveInside(IMPORTS_DIRECTORY), { recursive: true });
    return path;
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
