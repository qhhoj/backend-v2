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

const withTimeout = <Value>(
  work: Promise<Value>,
  timeoutMs: number,
): Promise<Value> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`PDF rendering exceeded ${timeoutMs} ms`)),
      timeoutMs,
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
    const pageUrl = pathToFileURL(htmlPath).href;
    const resourcePaths = [KATEX_DIST_DIR, this.env.mediaRoot];
    const context = await (
      await this.launch()
    ).newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    try {
      // Statement content (images, iframes, stylesheets, redirects) may only load KaTeX and MEDIA_ROOT files: no SSRF, no other local file.
      // The page file itself is allowed only as the top-level navigation, so an `<iframe src="?x">` cannot embed it again.
      // `data:` and `srcdoc` documents are not routed by Playwright; they are inert (no JavaScript, and their requests go through this route).
      await context.route('**/*', async (route) => {
        const request = route.request();
        const isPage =
          request.url() === pageUrl &&
          request.isNavigationRequest() &&
          request.frame().parentFrame() === null;
        return isPage || (await isAllowedRequest(request.url(), resourcePaths))
          ? route.continue()
          : route.abort();
      });
      const page = await context.newPage();
      await withTimeout(
        this.printPage(page, pageUrl, pdfPath),
        this.env.pdfRenderTimeoutMs,
      );
      const { size } = await stat(pdfPath);
      if (size > this.env.pdfMaxBytes)
        throw new Error(
          `PDF is ${size} bytes, over the ${this.env.pdfMaxBytes} limit`,
        );
    } finally {
      await context.close();
    }
  }

  private async printPage(
    page: Awaited<ReturnType<Browser['newPage']>>,
    pageUrl: string,
    pdfPath: string,
  ): Promise<void> {
    await page.goto(pageUrl, { waitUntil: 'load' });
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
      .launch({
        args: [
          '--allow-file-access-from-files',
          '--host-resolver-rules=MAP * ~NOTFOUND',
        ],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          this.logger.warn('Chromium exited; it relaunches on the next job');
          this.browser = null;
        });
        return browser;
      })
      .catch((error: unknown) => {
        this.browser = null;
        throw error;
      });
    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    const browser = await this.browser?.catch(() => null);
    await browser?.close();
  }
}
