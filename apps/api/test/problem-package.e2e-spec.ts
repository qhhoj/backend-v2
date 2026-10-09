import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { EMPTY_TEST_CASE, emptyProblemData } from '@libs/database';
import type { Problem } from '@libs/database';
import {
  PACKAGE_QUEUE,
  PACKAGE_TOO_LARGE_REASON,
  PackageCacheService,
  packageJobId,
  packageKey,
} from '@libs/problems';
import type { ProblemPackageJob } from '@libs/problems';
import { clearRateLimits } from './contest-fixtures';
import { softDelete } from './deleted-problem-fixtures';
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
import { dataOf } from './submission-fixtures';

const PROBLEMS = '/api/internal/problems';

describe('problem package download', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let queue: Queue<ProblemPackageJob>;
  let cache: PackageCacheService;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  let sequence = 0;
  const editable = async (extra: object = {}) => {
    sequence += 1;
    return createProblem(api, catalog, {
      code: `pk${sequence}`,
      authors: [ids.editor],
      data: {
        ...emptyProblemData(),
        cases: [
          { ...EMPTY_TEST_CASE, input: '1.in', output: '1.out', points: 100 },
        ],
      },
      ...extra,
    });
  };
  const requestPackage = (who: string, code: string) =>
    authed(api.http().post(`${PROBLEMS}/${code}/package`), sessions[who]);
  const fetchPackage = (who: string, code: string) =>
    authed(api.http().get(`${PROBLEMS}/${code}/package`), sessions[who])
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          const isZip = String(response.headers['content-type']).includes(
            'zip',
          );
          done(
            null,
            isZip ? body : (JSON.parse(body.toString() || 'null') as object),
          );
        });
      });
  const keyOf = async (id: string) =>
    packageKey(
      (await api.problems.findById(id).select('+data').lean<Problem>())!,
    );
  const cached = async (code: string, key: string, content: string) => {
    await cache.write(code, key, (temporary) =>
      Promise.resolve(writeFileSync(temporary, content)),
    );
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    queue = api.app.get(getQueueToken(PACKAGE_QUEUE));
    cache = api.app.get(PackageCacheService);
    for (const [name, permissions] of [
      ['editor', ['judge.edit_own_problem']],
      ['reader', []],
    ] as Array<[string, string[]]>) {
      const user = await createUserWith(api, name, { permissions });
      ids[name] = user._id;
      sessions[name] = await loginAs(api, user._id);
    }
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await clearRateLimits(api);
    await queue.obliterate({ force: true });
  });

  it('is for editors only: 401, 403 for a reader of a public problem, 404 for a private one', async () => {
    const open = await editable({ isPublic: true });
    const hidden = await editable({ isPublic: false });
    await api.http().post(`${PROBLEMS}/${open.code}/package`).expect(401);
    await requestPackage('reader', open.code).expect(403);
    await fetchPackage('reader', open.code).expect(403);
    await requestPackage('reader', hidden.code).expect(404);
  });

  it('queues one build per problem and key, however many editors ask', async () => {
    const problem = await editable();
    const key = await keyOf(problem._id);
    const first = dataOf<{ status: string; key: string }>(
      await requestPackage('editor', problem.code).expect(202),
    );
    expect(first).toEqual({ status: 'building', key });
    await requestPackage('editor', problem.code).expect(202);
    expect((await queue.getJobs(['waiting'])).map((job) => job.id)).toEqual([
      packageJobId(problem.code, key),
    ]);
    const waiting = await fetchPackage('editor', problem.code).expect(202);
    expect(waiting.headers['retry-after']).toBeDefined();
  });

  it('answers 200 ready for a cached package and streams it as an attachment', async () => {
    const problem = await editable();
    const key = await keyOf(problem._id);
    await cached(problem.code, key, 'ZIP-BYTES');
    expect(
      dataOf<{ status: string }>(
        await requestPackage('editor', problem.code).expect(200),
      ).status,
    ).toBe('ready');
    const download = await fetchPackage('editor', problem.code).expect(200);
    expect(download.headers['content-type']).toContain('application/zip');
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename="${problem.code}.zip"`,
    );
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((download.body as Buffer).toString()).toBe('ZIP-BYTES');
    expect(await queue.getJobs(['waiting'])).toHaveLength(0);
  });

  it('never serves a zip from before an edit: the key moves with the content', async () => {
    const problem = await editable();
    const before = await keyOf(problem._id);
    await cached(problem.code, before, 'OLD');
    await api.problems.updateOne(
      { _id: problem._id },
      { description: 'Edited statement.' },
    );
    await fetchPackage('editor', problem.code)
      .expect(404)
      .expect(errorCode('package_not_built'));
    await requestPackage('editor', problem.code).expect(202);
  });

  it('says nothing was requested with 404 package_not_built', async () => {
    const problem = await editable();
    await fetchPackage('editor', problem.code)
      .expect(404)
      .expect(errorCode('package_not_built'));
  });

  it('reports a build over the size cap as 409 and any other failed build as 503', async () => {
    const tooLarge = await editable();
    const crashed = await editable();
    const reasons = new Map([[tooLarge.code, PACKAGE_TOO_LARGE_REASON]]);
    const failing = new Worker<ProblemPackageJob>(
      PACKAGE_QUEUE,
      (job) =>
        Promise.reject(
          new Error(reasons.get(job.data.code) ?? 'build crashed'),
        ),
      { connection: { url: TEST_REDIS_URL } },
    );
    await failing.waitUntilReady();
    try {
      for (const problem of [tooLarge, crashed]) {
        await requestPackage('editor', problem.code).expect(202);
        const key = await keyOf(problem._id);
        await waitUntil(
          async () =>
            (await queue.getJob(packageJobId(problem.code, key)))?.isFailed() ??
            false,
        );
      }
      await fetchPackage('editor', tooLarge.code)
        .expect(409)
        .expect(errorCode('package_too_large'));
      await requestPackage('editor', tooLarge.code)
        .expect(409)
        .expect(errorCode('package_too_large'));
      const unavailable = await fetchPackage('editor', crashed.code).expect(
        503,
      );
      expect(unavailable.headers['retry-after']).toBeDefined();
    } finally {
      await failing.close();
    }
  });

  it('allows three requests an hour per user and problem, counted on POST only', async () => {
    const problem = await editable();
    for (let count = 0; count < 3; count += 1)
      await requestPackage('editor', problem.code).expect(202);
    await requestPackage('editor', problem.code)
      .expect(429)
      .expect(errorCode('rate_limited'));
    await fetchPackage('editor', problem.code).expect(202);
    const other = await editable();
    await requestPackage('editor', other.code).expect(202);
  });

  it('does not package a deleted problem', async () => {
    const problem = await editable();
    await softDelete(api, problem._id);
    await requestPackage('editor', problem.code).expect(404);
    await fetchPackage('editor', problem.code).expect(404);
  });

  it('drops the cached zips of both codes when a problem is renamed', async () => {
    const problem = await editable();
    const key = await keyOf(problem._id);
    await cached(problem.code, key, 'OLD');
    const newCode = `${problem.code}_new`;
    await authed(
      api.http().patch(`${PROBLEMS}/${problem.code}`),
      sessions.editor,
    )
      .send({ code: newCode })
      .expect(200);
    const packages = join(api.pdfCacheRoot, 'packages');
    await waitUntil(
      () =>
        !readdirSync(packages).some((name) =>
          name.startsWith(`${problem.code}.`),
        ),
    );
  });
});
