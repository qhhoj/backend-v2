import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { chromium } from 'playwright';
import { newId } from '@libs/database';
import type { PdfRenderJob } from '@libs/problems';
import { PdfRenderProcessor } from '../src/jobs/pdf-render/pdf-render.processor';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const describeWithChromium = existsSync(chromium.executablePath())
  ? describe
  : describe.skip;

const job = (data: PdfRenderJob) => ({ data }) as Job<PdfRenderJob>;
const baseProblem = {
  timeLimit: 1,
  memoryLimit: 262144,
  points: 1000,
  typeIds: [newId()],
  groupId: newId(),
  languageLimits: [],
  description: 'raw',
};
const heavyHtml = `<table>${'<tr><td>cell</td><td>cell</td></tr>'.repeat(20000)}</table>`;

describeWithChromium('PdfRenderProcessor limits (Chromium)', () => {
  describe('render timeout', () => {
    let worker: WorkerTest;
    let processor: PdfRenderProcessor;
    beforeAll(async () => {
      worker = await setupWorkerTest({
        env: { PDF_RENDER_TIMEOUT_MS: '200' },
      });
      processor = worker.module.get(PdfRenderProcessor);
      await worker.problems.create([
        {
          ...baseProblem,
          code: 'heavy',
          name: 'Heavy',
          descriptionHtml: heavyHtml,
        },
        {
          ...baseProblem,
          code: 'light',
          name: 'Light',
          descriptionHtml: '<p>hi</p>',
        },
      ]);
    });
    afterAll(() => worker.teardown());

    it('aborts a render that outlives the timeout, leaves nothing behind and keeps serving', async () => {
      await processor.process(job({ code: 'light', lang: 'en' }));
      await expect(
        processor.process(job({ code: 'heavy', lang: 'en' })),
      ).rejects.toThrow('exceeded 200 ms');
      expect(existsSync(join(worker.pdfCacheRoot, 'heavy.en.pdf'))).toBe(false);
      expect(readdirSync(join(worker.pdfCacheRoot, '.tmp'))).toEqual([]);
      expect(
        readdirSync(worker.pdfCacheRoot).filter((name) =>
          /\.pdf\..*\.tmp$/.test(name),
        ),
      ).toEqual([]);
      expect(await processor.process(job({ code: 'light', lang: 'en' }))).toBe(
        'rendered',
      );
    });
  });

  describe('size cap', () => {
    let worker: WorkerTest;
    let processor: PdfRenderProcessor;
    beforeAll(async () => {
      worker = await setupWorkerTest({ env: { PDF_MAX_BYTES: '500' } });
      processor = worker.module.get(PdfRenderProcessor);
      await worker.problems.create({
        ...baseProblem,
        code: 'big',
        name: 'Big',
        descriptionHtml: '<p>hi</p>',
      });
    });
    afterAll(() => worker.teardown());

    it('rejects a PDF over the cap and leaves no file', async () => {
      await expect(
        processor.process(job({ code: 'big', lang: 'en' })),
      ).rejects.toThrow('over the 500 limit');
      expect(existsSync(join(worker.pdfCacheRoot, 'big.en.pdf'))).toBe(false);
      expect(readdirSync(join(worker.pdfCacheRoot, '.tmp'))).toEqual([]);
    });
  });
});
