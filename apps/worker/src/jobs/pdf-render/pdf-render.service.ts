import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { uuidStr } from '@libs/database';
import { PdfCacheService, statementFor } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { BrowserService } from './browser.service';
import { PdfRenderRepository } from './pdf-render.repository';
import { buildPdfHtml, KATEX_DIST_DIR } from './pdf-template';

@Injectable()
export class PdfRenderService {
  private readonly logger = new Logger(PdfRenderService.name);

  constructor(
    private readonly repository: PdfRenderRepository,
    private readonly browser: BrowserService,
    private readonly pdfCache: PdfCacheService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Renders `<code>.<lang>.pdf` into the cache from the stored statement HTML; a problem deleted meanwhile is skipped (visibility was checked by the api). */
  async render({ code, lang }: PdfRenderJob): Promise<'rendered' | 'missing'> {
    const problem = await this.repository.findByCode(code);
    if (!problem) {
      this.logger.warn(`No problem ${code}; nothing to render`);
      return 'missing';
    }
    const statement = statementFor(problem, lang);
    const names = await this.repository.languageNames(
      problem.languageLimits.map((limit) => uuidStr(limit.languageId)),
    );
    const html = buildPdfHtml({
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
    const htmlPath = await this.pdfCache.scratchPath(
      `${code}.${lang}.${randomUUID()}.html`,
    );
    await writeFile(htmlPath, html, 'utf8');
    try {
      await this.pdfCache.write(code, lang, (temporary) =>
        this.browser.renderPdf(htmlPath, temporary),
      );
    } finally {
      await rm(htmlPath, { force: true });
    }
    return 'rendered';
  }
}
