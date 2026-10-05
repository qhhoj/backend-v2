import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ENV } from '@libs/common';
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
    return join(this.root, `${code}.${lang}.pdf`);
  }

  exists(code: string, lang: StatementLanguage): Promise<boolean> {
    return access(this.pathOf(code, lang)).then(
      () => true,
      () => false,
    );
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
    await mkdir(this.root, { recursive: true });
    const target = this.pathOf(code, lang);
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
    const directory = join(this.root, SCRATCH_DIRECTORY);
    await mkdir(directory, { recursive: true });
    return join(directory, name);
  }
}
