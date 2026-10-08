import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join, relative } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { Job } from 'bullmq';
import { chromium } from 'playwright';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { newId } from '@libs/database';
import { renderMarkdown } from '@libs/render';
import type { PdfRenderJob } from '@libs/problems';
import { BrowserService } from '../src/jobs/pdf-render/browser.service';
import { SettingsService } from '@libs/settings';
import { PdfRenderProcessor } from '../src/jobs/pdf-render/pdf-render.processor';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const chromiumAvailable = existsSync(chromium.executablePath());
const describeWithChromium = chromiumAvailable ? describe : describe.skip;

const pngChunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};
/** A square RGB PNG of random (incompressible) pixels: a PDF that embeds it is visibly larger. */
const noisePng = (side: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const scanlines = Buffer.concat(
    Array.from({ length: side }, () =>
      Buffer.concat([Buffer.from([0]), randomBytes(side * 3)]),
    ),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
const NOISE_PNG = noisePng(64);
const EMBEDDED_IMAGE_MIN_BYTES = 8000;

describeWithChromium('PdfRenderProcessor (Chromium)', () => {
  let worker: WorkerTest;
  let processor: PdfRenderProcessor;
  let spy: Server;
  const spiedPaths: string[] = [];
  let spyOrigin: string;
  const job = (data: PdfRenderJob) => ({ data }) as Job<PdfRenderJob>;
  const pdfOf = (name: string) => readFileSync(join(worker.pdfCacheRoot, name));

  beforeAll(async () => {
    spy = createServer((request, response) => {
      spiedPaths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(NOISE_PNG);
    });
    await new Promise<void>((done) => spy.listen(0, '127.0.0.1', done));
    const address = spy.address();
    spyOrigin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    worker = await setupWorkerTest();
    processor = worker.module.get(PdfRenderProcessor);
    mkdirSync(join(worker.mediaRoot, 'images'), { recursive: true });
    writeFileSync(join(worker.mediaRoot, 'images', 'fig.png'), NOISE_PNG);
    const python = await worker.languages.create({
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
    });
    const markdown =
      'Compute $a+b$.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![fig](/media/images/fig.png)';
    const hostile = [
      `<img src="${spyOrigin}/img.png">`,
      `<iframe src="${spyOrigin}/frame.html"></iframe>`,
      `<link rel="stylesheet" href="${spyOrigin}/style.css">`,
      `<object data="${spyOrigin}/object.png"></object>`,
      `<div style="background:url(${spyOrigin}/css.png)">x</div>`,
      '<img src="file:///etc/hostname">',
    ].join('');
    const base = {
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      typeIds: [newId()],
      groupId: newId(),
      languageLimits: [
        { languageId: python._id, timeLimit: 3, memoryLimit: 524288 },
      ],
    };
    await worker.problems.create({
      ...base,
      code: 'sum',
      name: 'Sum',
      description: markdown,
      descriptionHtml: renderMarkdown(markdown, 'problem'),
      translations: [
        {
          language: 'vi',
          name: 'Tổng',
          description: 'Tính $a+b$.',
          descriptionHtml: renderMarkdown('Tính $a+b$.', 'problem'),
        },
      ],
    });
    const missingImage = markdown.replace('fig.png', 'missing.png');
    await worker.problems.create({
      ...base,
      code: 'nomedia',
      name: 'No media',
      description: missingImage,
      descriptionHtml: renderMarkdown(missingImage, 'problem'),
    });
    const outside = join(worker.pdfCacheRoot, 'outside.png');
    writeFileSync(outside, NOISE_PNG);
    const outsideReferences = [
      `<img src="file://${outside}">`,
      `<img src="/media/${relative(worker.mediaRoot, outside)}">`,
      `<base href="file://${worker.pdfCacheRoot}/"><img src="outside.png">`,
      `<img src="file://${outside}?x#y">`,
    ].join('');
    await worker.problems.create({
      ...base,
      code: 'outside',
      name: 'Outside',
      description: 'raw',
      descriptionHtml: `<p>Hello</p>${outsideReferences}`,
    });
    await worker.problems.create({
      ...base,
      code: 'selfframes',
      name: 'Self frames',
      description: 'raw',
      descriptionHtml: `<p>Hello</p>${'<iframe src="?x"></iframe>'.repeat(50)}`,
    });
    await worker.problems.create({
      ...base,
      code: 'hostile',
      name: 'Hostile',
      description: 'raw',
      descriptionHtml: `<p>Hello</p>${hostile}`,
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await worker.teardown();
    await new Promise((done) => spy.close(done));
  });

  it('renders the translated statement to <code>.<lang>.pdf ', async () => {
    expect(await processor.process(job({ code: 'sum', lang: 'vi' }))).toBe(
      'rendered',
    );
    const pdf = pdfOf('sum.vi.pdf');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(existsSync(join(worker.pdfCacheRoot, 'sum.en.pdf'))).toBe(false);
  });
  it('embeds images resolved from MEDIA_ROOT', async () => {
    await processor.process(job({ code: 'sum', lang: 'en' }));
    await processor.process(job({ code: 'nomedia', lang: 'en' }));
    expect(
      pdfOf('sum.en.pdf').length - pdfOf('nomedia.en.pdf').length,
    ).toBeGreaterThan(EMBEDDED_IMAGE_MIN_BYTES);
  });
  it('never fetches external urls or other local files named by the statement', async () => {
    expect(await processor.process(job({ code: 'hostile', lang: 'en' }))).toBe(
      'rendered',
    );
    expect(spiedPaths).toEqual([]);
    expect(
      pdfOf('hostile.en.pdf').length - pdfOf('nomedia.en.pdf').length,
    ).toBeLessThan(EMBEDDED_IMAGE_MIN_BYTES);
  });
  it('does not load local files outside MEDIA_ROOT and KaTeX, however they are referenced', async () => {
    await processor.process(job({ code: 'hostile', lang: 'en' }));
    await processor.process(job({ code: 'outside', lang: 'en' }));
    expect(
      pdfOf('outside.en.pdf').length - pdfOf('hostile.en.pdf').length,
    ).toBeLessThan(EMBEDDED_IMAGE_MIN_BYTES);
  });
  it('does not let the page embed itself through iframes', async () => {
    await processor.process(job({ code: 'hostile', lang: 'en' }));
    const started = Date.now();
    await processor.process(job({ code: 'selfframes', lang: 'en' }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(
      pdfOf('selfframes.en.pdf').length - pdfOf('hostile.en.pdf').length,
    ).toBeLessThan(EMBEDDED_IMAGE_MIN_BYTES);
  });
  it('relaunches Chromium after a failed launch', async () => {
    const browser = new BrowserService(
      worker.module.get<Env>(ENV),
      worker.module.get(SettingsService),
    );
    const htmlPath = join(worker.pdfCacheRoot, 'launch.html');
    writeFileSync(htmlPath, '<p>hi</p>');
    const pdfPath = join(worker.pdfCacheRoot, 'launch.pdf');
    jest
      .spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error('no chromium'));
    await expect(browser.renderPdf(htmlPath, pdfPath)).rejects.toThrow(
      'no chromium',
    );
    await browser.renderPdf(htmlPath, pdfPath);
    expect(pdfOf('launch.pdf').subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await browser.onModuleDestroy();
  });
  it('tolerates shutdown after a failed launch', async () => {
    const browser = new BrowserService(
      worker.module.get<Env>(ENV),
      worker.module.get(SettingsService),
    );
    jest.spyOn(chromium, 'launch').mockRejectedValueOnce(new Error('boom'));
    await browser
      .renderPdf('/nonexistent.html', '/nonexistent.pdf')
      .catch(() => undefined);
    await expect(browser.onModuleDestroy()).resolves.toBeUndefined();
  });
  it('leaves no scratch html behind', () => {
    expect(readdirSync(join(worker.pdfCacheRoot, '.tmp'))).toEqual([]);
  });
  it('discards a render whose statement changed meanwhile', async () => {
    const browser = worker.module.get(BrowserService);
    const renderPdf = browser.renderPdf.bind(browser);
    const spyOnRender = jest
      .spyOn(browser, 'renderPdf')
      .mockImplementationOnce(async (htmlPath, pdfPath) => {
        await renderPdf(htmlPath, pdfPath);
        await worker.problems.updateOne(
          { code: 'nomedia' },
          { descriptionHtml: '<p>Edited while rendering</p>' },
        );
      });
    try {
      expect(
        await processor.process(job({ code: 'nomedia', lang: 'en' })),
      ).toBe('stale');
    } finally {
      spyOnRender.mockRestore();
    }
    expect(
      readdirSync(worker.pdfCacheRoot).filter((name) =>
        name.startsWith('nomedia.en.pdf.'),
      ),
    ).toEqual([]);
    const cachedBefore = pdfOf('nomedia.en.pdf');
    expect(await processor.process(job({ code: 'nomedia', lang: 'en' }))).toBe(
      'rendered',
    );
    expect(pdfOf('nomedia.en.pdf').equals(cachedBefore)).toBe(false);
  });
  it('skips a missing problem without writing a file', async () => {
    expect(await processor.process(job({ code: 'ghost', lang: 'en' }))).toBe(
      'missing',
    );
    expect(existsSync(join(worker.pdfCacheRoot, 'ghost.en.pdf'))).toBe(false);
  });
});
