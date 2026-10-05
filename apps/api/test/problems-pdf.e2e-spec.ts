import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { PDF_QUEUE, pdfJobId } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { PDF_JOB_RETRY_LIMIT } from '../src/modules/problems/rate-limits';
import { createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';

const waitUntil = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !(await condition()); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 50));
};

describe('GET /api/internal/problems/:code/pdf', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let queue: Queue<PdfRenderJob>;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    queue = api.app.get(getQueueToken(PDF_QUEUE));
    for (const code of ['sum', 'again', 'busy', 'broken'])
      await createProblem(api, catalog, { code });
    await createProblem(api, catalog, { code: 'hidden', isPublic: false });
  });
  afterAll(() => api.teardown());

  it('answers 202 and enqueues one job per problem and language, deduplicated', async () => {
    expect(
      (await api.http().get(`${PROBLEMS}/sum/pdf`).expect(202)).body,
    ).toEqual({ data: { status: 'rendering' } });
    await api.http().get(`${PROBLEMS}/sum/pdf`).expect(202);
    await api.http().get(`${PROBLEMS}/sum/pdf?lang=vi`).expect(202);
    expect((await queue.getJob(pdfJobId('sum', 'en')))?.data).toEqual({
      code: 'sum',
      lang: 'en',
    });
    expect((await queue.getJob(pdfJobId('sum', 'vi')))?.data).toEqual({
      code: 'sum',
      lang: 'vi',
    });
    expect(await queue.getWaitingCount()).toBe(2);
  });
  it('serves the cached file inline', async () => {
    mkdirSync(api.pdfCacheRoot, { recursive: true });
    writeFileSync(join(api.pdfCacheRoot, 'sum.en.pdf'), '%PDF-1.4 cached');
    const response = await api
      .http()
      .get(`${PROBLEMS}/sum/pdf`)
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe(
      'inline; filename="sum.en.pdf"',
    );
    expect((response.body as Buffer).toString()).toBe('%PDF-1.4 cached');
    await api.http().get(`${PROBLEMS}/sum/pdf?lang=vi`).expect(202);
  });
  it('enqueues again after the previous job completed', async () => {
    const worker = new Worker(PDF_QUEUE, () => Promise.resolve('rendered'), {
      connection: { url: TEST_REDIS_URL },
    });
    await worker.waitUntilReady();
    const completed = new Promise<void>((resolve) =>
      worker.on(
        'completed',
        (job) => job.id === pdfJobId('again', 'en') && resolve(),
      ),
    );
    await api.http().get(`${PROBLEMS}/again/pdf`).expect(202);
    await completed;
    await worker.close();
    expect(await queue.getJob(pdfJobId('again', 'en'))).toBeUndefined();
    await api.http().get(`${PROBLEMS}/again/pdf`).expect(202);
    expect(await queue.getJob(pdfJobId('again', 'en'))).toBeDefined();
  }, 30000);
  it('hides invisible problems and validates the language', async () => {
    writeFileSync(join(api.pdfCacheRoot, 'hidden.en.pdf'), '%PDF-1.4 secret');
    await api.http().get(`${PROBLEMS}/hidden/pdf`).expect(404);
    await api.http().get(`${PROBLEMS}/nope/pdf`).expect(404);
    await api
      .http()
      .get(`${PROBLEMS}/sum/pdf?lang=fr`)
      .expect(400)
      .expect(errorCode('validation_failed'));
  });
  it('rate limits enqueue attempts per ip', async () => {
    const redis = api.app.get<Redis>(REDIS);
    const spent = await redis.keys('rate:*');
    if (spent.length) await redis.del(...spent);
    for (let attempt = 0; attempt < 30; attempt += 1)
      await api.http().get(`${PROBLEMS}/busy/pdf`).expect(202);
    await api
      .http()
      .get(`${PROBLEMS}/busy/pdf`)
      .expect(429)
      .expect(errorCode('rate_limited'));
  });
  it('answers 503 once renders keep failing, so clients stop polling', async () => {
    const redis = api.app.get<Redis>(REDIS);
    const spent = await redis.keys('rate:*');
    if (spent.length) await redis.del(...spent);
    const worker = new Worker(
      PDF_QUEUE,
      () => Promise.reject(new Error('render crashed')),
      {
        connection: { url: TEST_REDIS_URL },
      },
    );
    await worker.waitUntilReady();
    const failed = () =>
      new Promise<void>((resolve) => worker.once('failed', () => resolve()));
    for (let attempt = 0; attempt < PDF_JOB_RETRY_LIMIT; attempt += 1) {
      const settled = failed();
      await api.http().get(`${PROBLEMS}/broken/pdf`).expect(202);
      await settled;
      await waitUntil(
        async () => !(await queue.getJob(pdfJobId('broken', 'en'))),
      );
    }
    await api
      .http()
      .get(`${PROBLEMS}/broken/pdf`)
      .expect(503)
      .expect(errorCode('pdf_unavailable'));
    await worker.close();
  }, 30000);
});
