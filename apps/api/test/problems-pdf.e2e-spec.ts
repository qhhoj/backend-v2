import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { PDF_QUEUE, PdfCacheService, pdfJobId } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
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
  let editor: TestSession;
  let redis: Redis;
  const resetBudget = async () => {
    const spent = await redis.keys('rate:*');
    if (spent.length) await redis.del(...spent);
  };
  const cachePdf = (name: string, content = '%PDF-1.4 cached') => {
    mkdirSync(api.pdfCacheRoot, { recursive: true });
    writeFileSync(join(api.pdfCacheRoot, name), content);
  };
  const failingWorker = async () => {
    const worker = new Worker(
      PDF_QUEUE,
      () => Promise.reject(new Error('render crashed')),
      { connection: { url: TEST_REDIS_URL } },
    );
    await worker.waitUntilReady();
    return worker;
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    queue = api.app.get(getQueueToken(PDF_QUEUE));
    redis = api.app.get<Redis>(REDIS);
    const editorUser = await createUserWith(api, 'editor', {
      permissions: ['judge.edit_own_problem'],
    });
    editor = await loginAs(api, editorUser._id);
    for (const code of [
      'sum',
      'again',
      'busy',
      'broken',
      'edited',
      'cycles',
      'burst',
      'peek',
      'raced',
      'warm',
    ])
      await createProblem(api, catalog, { code, authors: [editorUser._id] });
    await createProblem(api, catalog, {
      code: 'duo',
      translations: [
        { language: 'vi', name: 'Duo', description: '', descriptionHtml: '' },
      ],
    });
    await createProblem(api, catalog, { code: 'hidden', isPublic: false });
  });
  afterAll(() => api.teardown());

  it('answers 202 and enqueues one job per problem and language, deduplicated', async () => {
    expect(
      (await api.http().get(`${PROBLEMS}/sum/pdf`).expect(202)).body,
    ).toEqual({ data: { status: 'rendering' } });
    await api.http().get(`${PROBLEMS}/sum/pdf`).expect(202);
    await api.http().get(`${PROBLEMS}/duo/pdf?lang=vi`).expect(202);
    await api.http().get(`${PROBLEMS}/sum/pdf?lang=vi`).expect(202);
    expect((await queue.getJob(pdfJobId('sum', 'en')))?.data).toEqual({
      code: 'sum',
      lang: 'en',
    });
    expect((await queue.getJob(pdfJobId('duo', 'vi')))?.data).toEqual({
      code: 'duo',
      lang: 'vi',
    });
    expect(await queue.getJob(pdfJobId('sum', 'vi'))).toBeUndefined();
    expect(await queue.getWaitingCount()).toBe(2);
  });
  it('serves the cached file inline', async () => {
    cachePdf('sum.en.pdf');
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
    expect(response.headers['content-length']).toBe('15');
    expect((response.body as Buffer).toString()).toBe('%PDF-1.4 cached');
  });
  it('serves the base statement file when the translation is missing', async () => {
    const response = await api
      .http()
      .get(`${PROBLEMS}/sum/pdf?lang=vi`)
      .expect(200);
    expect(response.headers['content-disposition']).toBe(
      'inline; filename="sum.en.pdf"',
    );
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
  it('answers 503 with Retry-After after a failed render, until the statement changes', async () => {
    await resetBudget();
    const worker = await failingWorker();
    const failed = new Promise<void>((resolve) =>
      worker.once('failed', () => resolve()),
    );
    await api.http().get(`${PROBLEMS}/edited/pdf`).expect(202);
    await failed;
    await worker.close();
    const refused = await api
      .http()
      .get(`${PROBLEMS}/edited/pdf`)
      .expect(503)
      .expect(errorCode('pdf_unavailable'));
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    await authed(api.http().patch(`${PROBLEMS}/edited`), editor)
      .send({ description: 'Fixed text' })
      .expect(200);
    await waitUntil(
      async () => !(await queue.getJob(pdfJobId('edited', 'en'))),
    );
    await api.http().get(`${PROBLEMS}/edited/pdf`).expect(202);
    const job = await queue.getJob(pdfJobId('edited', 'en'));
    expect(job).toBeDefined();
    expect(await job?.isFailed()).toBe(false);
  }, 30000);
  it('never answers 503 across successful renders', async () => {
    await resetBudget();
    const worker = new Worker(PDF_QUEUE, () => Promise.resolve('rendered'), {
      connection: { url: TEST_REDIS_URL },
    });
    await worker.waitUntilReady();
    for (let cycle = 0; cycle < 6; cycle += 1) {
      await api.http().get(`${PROBLEMS}/cycles/pdf`).expect(202);
      await waitUntil(
        async () => !(await queue.getJob(pdfJobId('cycles', 'en'))),
      );
    }
    await worker.close();
  }, 30000);
  it('makes exactly one job out of a concurrent burst', async () => {
    await resetBudget();
    await Promise.all(
      Array.from({ length: 30 }, () =>
        api.http().get(`${PROBLEMS}/burst/pdf`).expect(202),
      ),
    );
    const waiting = await queue.getWaiting();
    expect(waiting.filter((job) => job.data.code === 'burst')).toHaveLength(1);
  });
  it('does not spend the ip budget on cached hits', async () => {
    await resetBudget();
    cachePdf('warm.en.pdf');
    for (let hit = 0; hit < 40; hit += 1)
      await api.http().get(`${PROBLEMS}/warm/pdf`).expect(200);
    expect(await redis.keys('rate:*pdf-render*')).toEqual([]);
  });
  it('answers HEAD from the cache only, never enqueueing or spending budget', async () => {
    await resetBudget();
    cachePdf('peek.en.pdf');
    const cached = await api.http().head(`${PROBLEMS}/peek/pdf`).expect(200);
    expect(cached.headers['content-type']).toBe('application/pdf');
    await api.http().head(`${PROBLEMS}/again2/pdf`).expect(404);
    await api.http().head(`${PROBLEMS}/busy/pdf?lang=vi`).expect(202);
    expect(await queue.getJob(pdfJobId('busy', 'vi'))).toBeUndefined();
    expect(await redis.keys('rate:*pdf-render*')).toEqual([]);
  });
  it('falls back to rendering when the file vanishes before it is opened', async () => {
    await resetBudget();
    cachePdf('raced.en.pdf');
    const cache = api.app.get(PdfCacheService);
    const open = cache.open.bind(cache);
    const spy = jest
      .spyOn(cache, 'open')
      .mockImplementationOnce((code, lang) => {
        rmSync(join(api.pdfCacheRoot, 'raced.en.pdf'));
        return open(code, lang);
      });
    try {
      await api.http().get(`${PROBLEMS}/raced/pdf`).expect(202);
    } finally {
      spy.mockRestore();
    }
    expect(await queue.getJob(pdfJobId('raced', 'en'))).toBeDefined();
  });
});
