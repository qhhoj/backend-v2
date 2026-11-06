import { Inject, Injectable } from '@nestjs/common';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertRealPathInside,
  atomicWrite,
  ENV,
  resolveInside,
  SAFE_SEGMENT,
} from '@libs/common';
import type { Env } from '@libs/common';
import { PROBLEM_CODE_PATTERN, STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';

const SCRATCH_DIRECTORY = '.tmp';

/** A cached PDF as one read of the cache saw it. */
export interface CachedPdf {
  language: StatementLanguage;
  path: string;
  bytes: number;
  mtimeMs: number;
}

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

  /** The PDFs the cache holds for the problem right now, in language order: the one read the package build and the package key both use. */
  async listing(code: string): Promise<CachedPdf[]> {
    const found: CachedPdf[] = [];
    for (const language of STATEMENT_LANGUAGES) {
      const path = this.pathOf(code, language);
      await assertRealPathInside(this.root, path);
      const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info)
        found.push({ language, path, bytes: info.size, mtimeMs: info.mtimeMs });
    }
    return found;
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
    await atomicWrite(target, produce, this.root);
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
    return resolveInside(this.root, relativePath, 'PDF_CACHE_ROOT');
  }
}
