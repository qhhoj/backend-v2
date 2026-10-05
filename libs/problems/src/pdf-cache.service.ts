import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { assertRealPathInside, ENV, SAFE_SEGMENT } from '@libs/common';
import type { Env } from '@libs/common';
import { PROBLEM_CODE_PATTERN, STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';

const SCRATCH_DIRECTORY = '.tmp';

/** `<PDF_CACHE_ROOT>/<code>.<lang>.pdf`, written by the worker and served by the api; a statement change or code rename deletes every language of the problem. */
@Injectable()
export class PdfCacheService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.pdfCacheRoot);
  }

  pathOf(code: string, lang: StatementLanguage): string {
    if (!PROBLEM_CODE_PATTERN.test(code))
      throw new Error(`Invalid problem code: ${code}`);
    if (!STATEMENT_LANGUAGES.includes(lang))
      throw new Error(`Invalid statement language: ${lang}`);
    return this.resolveInside(`${code}.${lang}.pdf`);
  }

  async exists(code: string, lang: StatementLanguage): Promise<boolean> {
    const path = this.pathOf(code, lang);
    await assertRealPathInside(this.root, path);
    return access(path).then(
      () => true,
      () => false,
    );
  }

  /** The cached file opened for reading (caller closes it), or null when there is none; holding the handle means a later deletion cannot break a response that already started. */
  async open(
    code: string,
    lang: StatementLanguage,
  ): Promise<FileHandle | null> {
    const path = this.pathOf(code, lang);
    await assertRealPathInside(this.root, path);
    return open(path, 'r').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  }

  async delete(code: string): Promise<void> {
    await Promise.all(
      STATEMENT_LANGUAGES.map((lang) =>
        rm(this.pathOf(code, lang), { force: true }),
      ),
    );
  }

  /** `produce` writes the PDF to a temporary path; it is renamed into place only when it resolves. */
  async write(
    code: string,
    lang: StatementLanguage,
    produce: (temporaryPath: string) => Promise<void>,
  ): Promise<void> {
    const target = this.pathOf(code, lang);
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
  }

  async scratchPath(name: string): Promise<string> {
    if (!SAFE_SEGMENT.test(name) || name.includes('..'))
      throw new Error(`Unsafe scratch file name: ${name}`);
    const path = this.resolveInside(`${SCRATCH_DIRECTORY}/${name}`);
    await mkdir(this.resolveInside(SCRATCH_DIRECTORY), { recursive: true });
    await assertRealPathInside(this.root, path);
    return path;
  }

  private resolveInside(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep))
      throw new Error(`Path escapes PDF_CACHE_ROOT: ${relativePath}`);
    return target;
  }
}
