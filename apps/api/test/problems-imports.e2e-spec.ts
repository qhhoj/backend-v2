import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import { POLYGON_ERROR_PREFIX, POLYGON_QUEUE } from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { buildZip } from '@libs/problems/testing';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { IMPORT_LIMIT } from '../src/modules/problems/rate-limits';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const IMPORTS = '/api/internal/problems/imports';
const UNKNOWN_ID = '0192b0e0-0000-7000-8000-000000000000';
const PACKAGE = buildZip([
  { name: 'problem.xml', content: '<problem/>' },
  { name: 'tests/01', content: '1' },
]);
const jobIdOf = ({ body }: { body: unknown }) =>
  (body as { data: { jobId: string } }).data.jobId;
const fieldsOf = ({ body }: { body: unknown }) =>
  (body as { error: { fields: Record<string, string[]> } }).error.fields;
interface Status {
  id: string;
  state: string;
  result: unknown;
  error: string | null;
}

describe('Polygon import routes', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let importer: TestSession, plain: TestSession, admin: TestSession;
  let creator: TestSession, otherImporter: TestSession;
  let importerId: string, creatorId: string;
  let queue: Queue<PolygonImportJob>;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    queue = api.app.get(getQueueToken(POLYGON_QUEUE));
    importerId = (
      await createUserWith(api, 'importer', {
        permissions: ['judge.import_polygon_package', 'judge.edit_own_problem'],
      })
    )._id;
    importer = await loginAs(api, importerId);
    creatorId = (
      await createUserWith(api, 'creator', {
        permissions: ['judge.import_polygon_package', 'judge.add_problem'],
      })
    )._id;
    creator = await loginAs(api, creatorId);
    otherImporter = await loginAs(
      api,
      (
        await createUserWith(api, 'other', {
          permissions: ['judge.import_polygon_package'],
        })
      )._id,
    );
    plain = await loginAs(api, (await createUserWith(api, 'plain'))._id);
    admin = await loginAs(
      api,
      (await createUserWith(api, 'admin', { isSuperuser: true }))._id,
    );
    await createProblem(api, catalog, {
      code: 'mine',
      authors: [importerId],
      dataVersion: 3,
    });
    await createProblem(api, catalog, { code: 'theirs' });
    await createProblem(api, catalog, {
      code: 'fancy',
      authors: [importerId],
      isFullMarkup: true,
    });
    await createProblem(api, catalog, {
      code: 'managed',
      authors: [importerId],
      isManuallyManaged: true,
    });
  });
  afterAll(() => api.teardown());

  const importsDirectory = () => join(api.problemDataRoot, '.imports');
  const storedPackages = () => readdirSync(importsDirectory());
  const upload = (
    query: string,
    session: TestSession,
    content: Buffer = PACKAGE,
  ) =>
    authed(api.http().post(`${IMPORTS}?${query}`), session).attach(
      'file',
      content,
      { filename: 'package.zip', contentType: 'application/zip' },
    );
  const statusOf = (jobId: string, session: TestSession) =>
    authed(api.http().get(`${IMPORTS}/${jobId}`), session);
  /** A stand-in worker that fails every job it takes, with the reason chosen by the problem code. */
  const failAllJobs = async (reasonOf: (code: string) => string) => {
    const connection = (await queue.client).duplicate({
      maxRetriesPerRequest: null,
    });
    const worker = new Worker<PolygonImportJob>(
      POLYGON_QUEUE,
      (job) => Promise.reject(new Error(reasonOf(job.data.code))),
      {
        connection,
        prefix: queue.opts.prefix,
      },
    );
    await new Promise<void>((resolve) => worker.on('drained', () => resolve()));
    await worker.close();
    await connection.quit();
  };

  it('stores the package and enqueues a create job with only the given catalog fields', async () => {
    const jobId = jobIdOf(
      await upload(
        `code=newsum&statementLanguages=vietnamese=vi&mainStatementLanguage=english&appendMainSolution=true&points=900&groupId=${catalog.groups.voi}`,
        creator,
      ).expect(202),
    );
    const job = await queue.getJob(jobId);
    expect(job?.data).toEqual({
      packagePath: join(importsDirectory(), `${jobId}.zip`),
      requesterId: creatorId,
      code: 'newsum',
      mode: 'create',
      curators: [creatorId],
      groupId: catalog.groups.voi,
      points: 900,
      isFullMarkup: false,
      mainStatementLanguage: 'english',
      statementLanguages: { vietnamese: 'vi' },
      tutorialLanguage: null,
      ignoreZeroPointBatches: false,
      ignoreZeroPointCases: false,
      appendMainSolution: true,
    });
    expect(existsSync(job!.data.packagePath)).toBe(true);
    expect((await statusOf(jobId, creator).expect(200)).body).toEqual({
      data: { id: jobId, state: 'waiting', result: null, error: null },
    });
  });
  it('adds the requester to the given curators once', async () => {
    const jobId = jobIdOf(
      await upload(
        `code=cur1&curators=${importerId}&curators=${creatorId}`,
        creator,
      ).expect(202),
    );
    expect((await queue.getJob(jobId))?.data.curators).toEqual([
      importerId,
      creatorId,
    ]);
  });
  it('shows a job only to its requester and a superuser', async () => {
    const jobId = jobIdOf(await upload('code=seen', creator).expect(202));
    await statusOf(jobId, plain).expect(403);
    await statusOf(jobId, otherImporter).expect(404);
    await statusOf(jobId, admin).expect(200);
    await statusOf(UNKNOWN_ID, creator).expect(404);
    await statusOf('not-a-uuid', creator).expect(400);
  });
  it('validates the query strictly before storing anything', async () => {
    const before = storedPackages().length;
    expect(
      fieldsOf(await upload('code=mine', creator).expect(400)),
    ).toHaveProperty('code');
    expect(
      fieldsOf(await upload('code=Bad', creator).expect(400)),
    ).toHaveProperty('code');
    expect(
      fieldsOf(await upload('code=x1&mode=delete', creator).expect(400)),
    ).toHaveProperty('mode');
    expect(
      fieldsOf(await upload('code=x1&points=abc', creator).expect(400)),
    ).toHaveProperty('points');
    expect(
      fieldsOf(await upload('code=x1&groupId=nope', creator).expect(400)),
    ).toHaveProperty('groupId');
    expect(
      fieldsOf(
        await upload('code=x1&appendMainSolution=maybe', creator).expect(400),
      ),
    ).toHaveProperty('appendMainSolution');
    expect(
      fieldsOf(
        await upload('code=x1&statementLanguages=english-en', creator).expect(
          400,
        ),
      ),
    ).toHaveProperty('statementLanguages');
    expect(
      fieldsOf(
        await upload(`code=x1&typeIds=${UNKNOWN_ID}`, creator).expect(400),
      ),
    ).toHaveProperty('typeIds');
    expect(
      fieldsOf(
        await upload(`code=x1&authors=${UNKNOWN_ID}`, creator).expect(400),
      ),
    ).toHaveProperty('authors');
    expect(storedPackages()).toHaveLength(before);
  });
  it('applies the create and update access rules', async () => {
    const before = storedPackages().length;
    await upload('code=x5', importer).expect(403);
    await upload('code=ghost&mode=update', importer).expect(404);
    await upload('code=theirs&mode=update', importer).expect(403);
    await upload('code=fancy&mode=update', importer)
      .expect(403)
      .expect(errorCode('forbidden'));
    await upload('code=managed&mode=update', importer).expect(404);
    expect(storedPackages()).toHaveLength(before);
  });
  it('keeps the catalog of an updated problem unless given and pins its data version', async () => {
    const jobId = jobIdOf(
      await upload('code=mine&mode=update&points=1500', importer).expect(202),
    );
    const data = (await queue.getJob(jobId))?.data;
    expect(data).toMatchObject({
      mode: 'update',
      points: 1500,
      isFullMarkup: false,
      expectedDataVersion: 3,
    });
    for (const key of [
      'authors',
      'curators',
      'groupId',
      'typeIds',
      'allowedLanguages',
    ])
      expect(data).not.toHaveProperty(key);
  });
  it('refuses a package without problem.xml or a non-zip and removes the file', async () => {
    const before = storedPackages().length;
    expect(
      fieldsOf(
        await upload(
          'code=x2',
          creator,
          buildZip([{ name: 'readme.txt', content: 'x' }]),
        ).expect(400),
      ),
    ).toHaveProperty('file');
    expect(
      fieldsOf(
        await upload('code=x3', creator, Buffer.from('nope')).expect(400),
      ),
    ).toHaveProperty('file');
    expect(storedPackages()).toHaveLength(before);
  });
  it('needs judge.import_polygon_package', async () => {
    await upload('code=x4', plain).expect(403);
    await api.http().post(`${IMPORTS}?code=x4`).expect(401);
  });
  it('shows an import error as is and hides any other failure reason', async () => {
    const hidden = jobIdOf(await upload('code=leak1', creator).expect(202));
    const shown = jobIdOf(await upload('code=leak2', creator).expect(202));
    await failAllJobs((code) =>
      code === 'leak2'
        ? `${POLYGON_ERROR_PREFIX}not full package`
        : 'ENOSPC: no space left, write /data/problems/.imports/a.zip',
    );
    const hiddenBody: unknown = (await statusOf(hidden, creator).expect(200))
      .body;
    expect((hiddenBody as { data: Status }).data).toMatchObject({
      state: 'failed',
      error: 'Import failed',
    });
    expect(JSON.stringify(hiddenBody)).not.toContain('/data/');
    const shownBody: unknown = (await statusOf(shown, creator).expect(200))
      .body;
    expect((shownBody as { data: Status }).data.error).toBe('not full package');
  });
  it('caps the import error it shows', async () => {
    const jobId = jobIdOf(await upload('code=longerr', creator).expect(202));
    await failAllJobs(() => `${POLYGON_ERROR_PREFIX}${'x'.repeat(5000)}`);
    const body = (await statusOf(jobId, creator).expect(200)).body as {
      data: Status;
    };
    expect(body.data.error).toBe('x'.repeat(1000));
  });
  it('rate-limits imports per user and sweeps stale packages', async () => {
    const stale = join(importsDirectory(), 'stale.zip');
    writeFileSync(stale, 'x');
    const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    utimesSync(stale, longAgo, longAgo);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < IMPORT_LIMIT + 2; attempt += 1)
      statuses.push(
        (await upload('code=rl', admin, Buffer.from('nope'))).status,
      );
    expect(statuses).toEqual([
      ...Array<number>(IMPORT_LIMIT).fill(400),
      429,
      429,
    ]);
    expect(existsSync(stale)).toBe(false);
  });
});
