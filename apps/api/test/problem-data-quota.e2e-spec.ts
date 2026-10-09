import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import { POLYGON_QUEUE, ProblemDataFilesService } from '@libs/problems';
import { buildZip } from '@libs/problems/testing';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';
import { ProblemDataStore } from '../src/modules/problems/data/problem-data.store';
import { createOrganization } from './organization-fixtures';
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
const tests = (count: number) =>
  Array.from({ length: count }, (_item, index) => [
    { name: `${index + 1}.in`, content: 'in' },
    { name: `${index + 1}.out`, content: 'out' },
  ]).flat();

describe('problem data quota', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  let polygon: Queue;
  let authorId: string;
  let author: TestSession;
  let counter = 0;
  const orgProblem = async (
    extra: Record<string, unknown> = {},
    orgExtra: Record<string, unknown> = {},
  ) => {
    counter += 1;
    const organization = await createOrganization(api, orgExtra);
    const problem = await createProblem(api, catalog, {
      code: `dq${counter}`,
      authors: [authorId],
      isPublic: false,
      isOrganizationPrivate: true,
      organizations: [organization._id],
      ...extra,
    });
    return { organization, problem };
  };
  const uploadArchive = (code: string, content: Buffer) =>
    authed(api.http().post(`${PROBLEMS}/${code}/data/archive`), author).attach(
      'file',
      content,
      { filename: 'tests.zip', contentType: 'application/octet-stream' },
    );
  const directoryBytes = (code: string) => {
    const directory = join(api.problemDataRoot, code);
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce(
        (sum, entry) => sum + statSync(join(directory, entry.name)).size,
        0,
      );
  };
  const dataBytesOf = async (id: string) =>
    (await api.problems.findById(id).lean())?.dataBytes;
  const creditsOf = async (organizationId: string) =>
    (await usage.findOne({ organization: organizationId }).lean())
      ?.creditsUsed ?? 0;
  const ledgerOf = async (organizationId: string) =>
    (
      await ledger
        .find({ organization: organizationId })
        .sort({ _id: 1 })
        .lean()
    ).map(({ reason, amount }) => [reason, amount]);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    polygon = api.app.get(getQueueToken(POLYGON_QUEUE));
    authorId = (
      await createUserWith(api, 'dqauthor', {
        permissions: ['judge.edit_own_problem', 'judge.import_polygon_package'],
      })
    )._id;
    author = await loginAs(api, authorId);
  });
  beforeEach(async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  });
  afterAll(() => api.teardown());

  it('records the size of the data directory after every kind of data write', async () => {
    const { problem } = await orgProblem();
    await uploadArchive(problem.code, buildZip(tests(2))).expect(201);
    expect(await dataBytesOf(problem._id)).toBe(directoryBytes(problem.code));
    const afterArchive = directoryBytes(problem.code);
    await authed(
      api.http().post(`${PROBLEMS}/${problem.code}/data/files/generator`),
      author,
    )
      .attach('file', Buffer.alloc(300, 'x'), {
        filename: 'gen.cpp',
        contentType: 'text/plain',
      })
      .expect(201);
    const afterSource = await dataBytesOf(problem._id);
    expect(afterSource).toBe(directoryBytes(problem.code));
    expect(afterSource).toBeGreaterThanOrEqual(afterArchive + 300);
    await authed(
      api.http().delete(`${PROBLEMS}/${problem.code}/data/files/generator`),
      author,
    ).expect(200);
    expect(await dataBytesOf(problem._id)).toBe(directoryBytes(problem.code));
    expect(await dataBytesOf(problem._id)).toBeLessThan(afterSource!);
  });

  it('charges one credit for a small archive of an organization problem and nothing for a public one', async () => {
    const { organization, problem } = await orgProblem();
    await uploadArchive(problem.code, buildZip(tests(1))).expect(201);
    expect(await creditsOf(organization._id)).toBe(1);
    const entries = await ledger
      .find({ organization: organization._id })
      .lean();
    expect(entries.map(({ reason, ref }) => [reason, ref])).toEqual([
      ['upload', problem.code],
    ]);
    counter += 1;
    const pub = await createProblem(api, catalog, {
      code: `dqpub${counter}`,
      authors: [authorId],
    });
    const before = await usage.countDocuments({});
    await uploadArchive(pub.code, buildZip(tests(1))).expect(201);
    expect(await usage.countDocuments({})).toBe(before);
  });

  it('refuses an upload that passes the storage limit before spending credits or writing', async () => {
    const { organization, problem } = await orgProblem(
      {},
      { quotaStorageBytes: 50 },
    );
    await uploadArchive(problem.code, buildZip(tests(3)))
      .expect(403)
      .expect(errorCode('quota_exceeded'));
    expect(await creditsOf(organization._id)).toBe(0);
    expect(await dataBytesOf(problem._id)).toBe(0);
    const directory = join(api.problemDataRoot, problem.code);
    const files = existsSync(directory) ? readdirSync(directory) : [];
    expect(files.filter((name) => name.endsWith('.zip'))).toEqual([]);
  });

  it('counts only the growth when an archive replaces an earlier one', async () => {
    const { problem, organization } = await orgProblem(
      {},
      { quotaStorageBytes: 100_000 },
    );
    const archive = buildZip(tests(2));
    await uploadArchive(problem.code, archive).expect(201);
    const used = (await dataBytesOf(problem._id))!;
    await api.organizations.updateOne(
      { _id: organization._id },
      { $set: { quotaStorageBytes: used + 5 } },
    );
    await uploadArchive(problem.code, archive).expect(201);
  });

  it('gives the credits back when storing the data fails', async () => {
    const { organization, problem } = await orgProblem();
    const failing = jest
      .spyOn(api.app.get(ProblemDataStore), 'compileAndStore')
      .mockRejectedValueOnce(new Error('disk full'));
    await uploadArchive(problem.code, buildZip(tests(1))).expect(500);
    failing.mockRestore();
    expect(await creditsOf(organization._id)).toBe(0);
    expect(await ledgerOf(organization._id)).toEqual([
      ['upload', 1],
      ['refund', -1],
    ]);
  });

  it('gives the credits back when committing the staged file fails after the data was stored', async () => {
    const { organization, problem } = await orgProblem();
    const failing = jest
      .spyOn(api.app.get(ProblemDataFilesService), 'commitUpload')
      .mockRejectedValueOnce(new Error('rename failed'));
    await uploadArchive(problem.code, buildZip(tests(1))).expect(500);
    failing.mockRestore();
    expect(await creditsOf(organization._id)).toBe(0);
    expect(await ledgerOf(organization._id)).toEqual([
      ['upload', 1],
      ['refund', -1],
    ]);
  });

  it('keeps the credits spent and the stored data when only recording dataBytes fails', async () => {
    const { organization, problem } = await orgProblem();
    const failing = jest
      .spyOn(api.app.get(ProblemsRepository), 'setDataBytes')
      .mockRejectedValueOnce(new Error('mongo blip'));
    await uploadArchive(problem.code, buildZip(tests(1))).expect(201);
    failing.mockRestore();
    expect(await creditsOf(organization._id)).toBe(1);
    expect(await ledgerOf(organization._id)).toEqual([['upload', 1]]);
    expect(
      existsSync(join(api.problemDataRoot, problem.code, 'tests.zip')),
    ).toBe(true);
  });

  it('gives the credits back when another data write holds the problem lock', async () => {
    const { organization, problem } = await orgProblem();
    const redis = api.app.get<Redis>(REDIS);
    const lock = `problem-data-lock:${problem.code}`;
    await redis.set(lock, 'other-writer', 'EX', 30);
    try {
      await uploadArchive(problem.code, buildZip(tests(1))).expect(409);
    } finally {
      await redis.del(lock);
    }
    expect(await creditsOf(organization._id)).toBe(0);
    expect(await ledgerOf(organization._id)).toEqual([
      ['upload', 1],
      ['refund', -1],
    ]);
  });

  it('lets an over-limit upload through in warn mode', async () => {
    await api.setSetting('quota.enforce', 'warn');
    const { problem } = await orgProblem(
      {},
      { quotaStorageBytes: 10, quotaMonthlyCredits: 0 },
    );
    await uploadArchive(problem.code, buildZip(tests(1))).expect(201);
  });

  it('refuses a Polygon import to an organization problem over the storage limit, keeping no package and queuing no job', async () => {
    const { problem } = await orgProblem({}, { quotaStorageBytes: 20 });
    const before = (await polygon.getJobs(['waiting', 'active'])).length;
    await authed(
      api.http().post(`${PROBLEMS}/imports?mode=update&code=${problem.code}`),
      author,
    )
      .attach(
        'file',
        buildZip([
          { name: 'problem.xml', content: '<problem/>' },
          { name: 'tests/01', content: '1'.repeat(200) },
        ]),
        { filename: 'package.zip', contentType: 'application/zip' },
      )
      .expect(403)
      .expect(errorCode('quota_exceeded'));
    expect((await polygon.getJobs(['waiting', 'active'])).length).toBe(before);
    expect(readdirSync(join(api.problemDataRoot, '.imports'))).toEqual([]);
  });
});
