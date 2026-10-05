import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Problem, StatementLanguage } from '@libs/database';
import { PdfCacheService, statementFor } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { BrowserService } from './browser.service';
import { PdfRenderRepository } from './pdf-render.repository';
import { buildPdfHtml, KATEX_DIST_DIR } from './pdf-template';

const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

class StaleRenderError extends Error {
  constructor() {
    super('Statement changed during the render');
  }
}

@Injectable()
export class PdfRenderService {
  private readonly logger = new Logger(PdfRenderService.name);

  constructor(
    private readonly repository: PdfRenderRepository,
    private readonly browser: BrowserService,
    private readonly pdfCache: PdfCacheService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Renders `<code>.<lang>.pdf` into the cache from the stored statement HTML; a problem deleted meanwhile is skipped (visibility was checked by the api), and a render whose template input changed before it was cached is discarded (the next request renders the new text). */
  async render({
    code,
    lang,
  }: PdfRenderJob): Promise<'rendered' | 'missing' | 'stale'> {
    const problem = await this.repository.findByCode(code);
    if (!problem) {
      this.logger.warn(`No problem ${code}; nothing to render`);
      return 'missing';
    }
    const html = await this.buildHtml(problem, lang);
    const htmlPath = await this.pdfCache.scratchPath(
      `${code}.${lang}.${randomUUID()}.html`,
    );
    await writeFile(htmlPath, html, 'utf8');
    try {
      await this.pdfCache.write(code, lang, async (temporary) => {
        await this.browser.renderPdf(htmlPath, temporary);
        if (!(await this.isUnchanged(code, lang, html)))
          throw new StaleRenderError();
      });
    } catch (error) {
      if (error instanceof StaleRenderError) {
        this.logger.warn(`${code}.${lang} changed while rendering; discarded`);
        return 'stale';
      }
      throw error;
    } finally {
      await rm(htmlPath, { force: true });
    }
    return 'rendered';
  }

  /** Same template input (statement, limits, language names) as a fresh read of the problem: guards the cache against a statement edit that landed mid-render. */
  private async isUnchanged(
    code: string,
    lang: StatementLanguage,
    renderedHtml: string,
  ): Promise<boolean> {
    const current = await this.repository.findByCode(code);
    return (
      current !== null &&
      digest(await this.buildHtml(current, lang)) === digest(renderedHtml)
    );
  }

  private async buildHtml(
    problem: Problem,
    lang: StatementLanguage,
  ): Promise<string> {
    const statement = statementFor(problem, lang);
    const names = await this.repository.languageNames(
      problem.languageLimits.map((limit) => uuidStr(limit.languageId)),
    );
    return buildPdfHtml({
      title: statement.name,
      descriptionHtml: statement.descriptionHtml,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit,
      languageLimits: problem.languageLimits.map((limit) => ({
        language: names.get(uuidStr(limit.languageId)) ?? 'Unknown language',
        timeLimit: limit.timeLimit,
        memoryLimit: limit.memoryLimit,
      })),
      materialUrl:
        problem.materialUrl &&
        (/^https?:\/\//.test(problem.materialUrl)
          ? problem.materialUrl
          : `${this.env.siteUrl}${problem.materialUrl}`),
      katexCssUrl: pathToFileURL(join(KATEX_DIST_DIR, 'katex.min.css')).href,
      mediaUrl: this.env.mediaUrl,
      mediaRoot: this.env.mediaRoot,
    });
  }
}
