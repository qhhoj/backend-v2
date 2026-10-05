import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { isAllowedRequest } from './local-file-policy';
import { KATEX_DIST_DIR, PAGE_FOOTER } from './pdf-template';

export const RENDER_TIMEOUT_MS = 30_000;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const withTimeout = <Value>(
  work: Promise<Value>,
  message: string,
): Promise<Value> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(message)),
      RENDER_TIMEOUT_MS,
    );
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/** One lazily launched Chromium per worker process; each render is a fresh JavaScript-less context that may only load the page, KaTeX and `MEDIA_ROOT` files. */
@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Promise<Browser> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async renderPdf(htmlPath: string, pdfPath: string): Promise<void> {
    const allowedPaths = [htmlPath, KATEX_DIST_DIR, this.env.mediaRoot];
    const context = await (
      await this.launch()
    ).newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    try {
      // Any request not for an allowed local file (statement images, iframes, redirects) is aborted: no SSRF from user content.
      await context.route('**/*', async (route) =>
        (await isAllowedRequest(route.request().url(), allowedPaths))
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      await withTimeout(
        this.printPage(page, htmlPath, pdfPath),
        `PDF rendering exceeded ${RENDER_TIMEOUT_MS} ms`,
      );
      const { size } = await stat(pdfPath);
      if (size > MAX_PDF_BYTES)
        throw new Error(
          `PDF is ${size} bytes, over the ${MAX_PDF_BYTES} limit`,
        );
    } finally {
      await context.close();
    }
  }

  private async printPage(
    page: Awaited<ReturnType<Browser['newPage']>>,
    htmlPath: string,
    pdfPath: string,
  ): Promise<void> {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: PAGE_FOOTER,
      margin: { top: '15mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
  }

  private launch(): Promise<Browser> {
    // file:// documents are opaque origins: without this flag Chromium blocks KaTeX's @font-face loads and falls back to system fonts.
    this.browser ??= chromium
      .launch({ args: ['--allow-file-access-from-files'] })
      .then((browser) => {
        browser.on('disconnected', () => {
          this.logger.warn('Chromium exited; it relaunches on the next job');
          this.browser = null;
        });
        return browser;
      });
    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await (await this.browser).close();
  }
}
