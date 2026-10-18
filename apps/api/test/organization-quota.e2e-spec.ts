import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QuotaService } from '../src/modules/organizations/quota/quota.service';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { createOrganization } from './organization-fixtures';
import { setupApiTest, errorCode } from './setup';
import type { ApiTest } from './setup';
import { ContestsRepository } from '../src/modules/contests/core/contests.repository';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { softDelete } from './deleted-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession, Catalog } from './problem-fixtures';
import { RevisionsRepository } from '../src/modules/problems/core/revisions.repository';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { NotificationsService } from '@libs/community';
import { POLYGON_QUEUE, ProblemDataFilesService } from '@libs/problems';
import { buildZip } from '@libs/problems/testing';
import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';
import { ProblemDataStore } from '../src/modules/problems/data/problem-data.store';

let api: ApiTest;
beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

describe('organization quota', () => {
  let quota: QuotaService;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  const userId = '0190a000-0000-7000-8000-000000000001';
  const request = (kind: 'problem' | 'contest' = 'problem') => ({
    kind,
    userId,
    ref: 'ref',
  });
  const enforce = async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  };
  const warn = async () => {
    await api.setSetting('quota.enforce', 'warn');
    await api.app.get<Redis>(REDIS).del(QUOTA_BACKFILL_DONE_KEY);
  };
  const limited = (credits: number) =>
    createOrganization(api, { quotaMonthlyCredits: credits });
  const usedBy = async (organizationId: string) =>
    (await usage.findOne({ organization: organizationId }).lean())?.creditsUsed;

  beforeAll(async () => {
    await api.reset();
    quota = api.app.get(QuotaService);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    await api.setSetting('quota.cost.problem', 10);
  });
  beforeEach(enforce);

  it('spends up to the limit, then refuses one more and leaves the counter unchanged', async () => {
    const organization = await limited(30);
    for (let index = 0; index < 3; index += 1)
      await quota.charged(organization._id, request(), () =>
        Promise.resolve('made'),
      );
    await expect(
      quota.charged(organization._id, request(), () => Promise.resolve('made')),
    ).rejects.toMatchObject({ code: 'quota_exceeded', status: 403 });
    expect(await usedBy(organization._id)).toBe(30);
  });

  it('never exceeds the limit under 20 parallel spends', async () => {
    const organization = await limited(100);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        quota.charged(organization._id, request(), () =>
          Promise.resolve('made'),
        ),
      ),
    );
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(10);
    expect(await usedBy(organization._id)).toBe(100);
  });

  it('lets an unlimited organization spend far above the default cap, still metering it, while a normal one is refused', async () => {
    const unlimited = await createOrganization(api, { quotaUnlimited: true });
    const normal = await createOrganization(api);
    await api.setSetting('quota.cost.problem', 1000);
    try {
      await quota.charged(unlimited._id, request(), () => Promise.resolve(1));
      expect(await usedBy(unlimited._id)).toBe(1000);
      await expect(
        quota.charged(normal._id, request(), () => Promise.resolve(1)),
      ).rejects.toMatchObject({ code: 'quota_exceeded' });
    } finally {
      await api.setSetting('quota.cost.problem', 10);
    }
  });

  it('refunds the spend and rethrows when the work fails', async () => {
    const organization = await limited(100);
    await expect(
      quota.charged(organization._id, request(), () =>
        Promise.reject(new Error('duplicate code')),
      ),
    ).rejects.toThrow('duplicate code');
    expect(await usedBy(organization._id)).toBe(0);
    const reasons = (
      await ledger
        .find({ organization: organization._id })
        .sort({ _id: 1 })
        .lean()
    ).map(({ reason, amount }) => [reason, amount]);
    expect(reasons).toEqual([
      ['problem', 10],
      ['refund', -10],
    ]);
  });

  it('writes no refund row when the counter was already lowered below the price', async () => {
    const organization = await limited(100);
    await expect(
      quota.charged(organization._id, request(), async () => {
        await usage.updateOne(
          { organization: organization._id },
          { $set: { creditsUsed: 0 } },
        );
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');
    expect(await usedBy(organization._id)).toBe(0);
    const reasons = (
      await ledger.find({ organization: organization._id }).lean()
    ).map(({ reason }) => reason);
    expect(reasons).toEqual(['problem']);
  });

  it('starts a new month at zero in the site time zone', async () => {
    await api.setSetting('site.timeZone', 'Asia/Ho_Chi_Minh');
    const organization = await limited(10);
    const lastSecondOfSeptember = new Date('2026-09-30T16:59:59Z');
    const firstSecondOfOctober = new Date('2026-09-30T17:00:00Z');
    await quota.charged(
      organization._id,
      request(),
      () => Promise.resolve(1),
      lastSecondOfSeptember,
    );
    await quota.charged(
      organization._id,
      request(),
      () => Promise.resolve(1),
      firstSecondOfOctober,
    );
    const rows = await usage
      .find({ organization: organization._id })
      .sort({ month: 1 })
      .lean();
    expect(rows.map(({ month, creditsUsed }) => [month, creditsUsed])).toEqual([
      ['2026-09', 10],
      ['2026-10', 10],
    ]);
  });

  describe('warn mode', () => {
    beforeEach(warn);
    it('lets an over-limit spend through and still counts it', async () => {
      const organization = await limited(5);
      await quota.charged(organization._id, request(), () =>
        Promise.resolve('made'),
      );
      expect(await usedBy(organization._id)).toBe(10);
    });
  });

  describe('storage meter', () => {
    it('refuses a write that passes the byte limit and names the numbers', async () => {
      const organization = await createOrganization(api, {
        quotaStorageBytes: 550,
      });
      await expect(
        quota.assertStorage(organization._id, {
          usedBytes: 500,
          addedBytes: 100,
        }),
      ).rejects.toMatchObject({
        code: 'quota_exceeded',
        extra: {
          details: { meter: 'storage', limit: 550, used: 500, needed: 100 },
        },
      });
      await expect(
        quota.assertStorage(organization._id, {
          usedBytes: 500,
          addedBytes: 50,
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('contest quota', () => {
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  let editorId: string;
  let editor: TestSession;
  let counter = 0;
  const newContest = (extra: Record<string, unknown> = {}) => {
    counter += 1;
    return {
      key: `quotac${counter}`,
      name: 'Quota contest',
      startTime: hoursFromNow(24).toISOString(),
      endTime: hoursFromNow(27).toISOString(),
      ...extra,
    };
  };
  const orgContest = (organizations: string[]) =>
    newContest({ isOrganizationPrivate: true, organizations });
  const post = (body: object, path = '/api/internal/contests') =>
    authed(api.http().post(path), editor).send(body);
  const usedBy = async (organizationId: string) =>
    (await usage.findOne({ organization: organizationId }).lean())
      ?.creditsUsed ?? null;
  const limited = (credits: number) =>
    // The editor administers them: a contest is scoped only to organizations its editor administers.
    createOrganization(api, {
      quotaMonthlyCredits: credits,
      adminIds: [editorId],
    });

  beforeAll(async () => {
    await api.reset();
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    editorId = (
      await createUserWith(api, 'quotacontest', {
        permissions: [
          'judge.add_contest',
          'judge.clone_contest',
          'judge.edit_own_contest',
          'judge.create_private_contest',
        ],
      })
    )._id;
    editor = await loginAs(api, editorId);
    await api.setSetting('quota.cost.contest', 20);
  });
  beforeEach(async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  });

  it('charges the contest price to the first listed organization', async () => {
    const first = await limited(100);
    const second = await limited(100);
    const body = orgContest([first._id, second._id]);
    await post(body).expect(201);
    expect(await usedBy(first._id)).toBe(20);
    expect(await usedBy(second._id)).toBeNull();
    const entries = await ledger.find({ organization: first._id }).lean();
    expect(entries.map(({ reason, ref }) => [reason, ref])).toEqual([
      ['contest', body.key],
    ]);
  });

  it('refuses at the limit and creates nothing', async () => {
    const organization = await limited(30);
    await post(orgContest([organization._id])).expect(201);
    const refused = orgContest([organization._id]);
    await post(refused).expect(403).expect(errorCode('quota_exceeded'));
    expect(await api.contests.countDocuments({ key: refused.key })).toBe(0);
    expect(await usedBy(organization._id)).toBe(20);
  });

  it('refunds when the key is already taken', async () => {
    const organization = await limited(100);
    const taken = await createContest(api, {
      key: `quotataken${(counter += 1)}`,
    });
    await post({ ...orgContest([organization._id]), key: taken.key })
      .expect(409)
      .expect(errorCode('conflict'));
    expect(await usedBy(organization._id)).toBe(0);
    const entries = await ledger
      .find({ organization: organization._id })
      .sort({ _id: 1 })
      .lean();
    expect(entries.map(({ reason, amount }) => [reason, amount])).toEqual([
      ['contest', 20],
      ['refund', -20],
    ]);
  });

  it('charges a clone of an organization contest', async () => {
    const organization = await limited(30);
    const source = await createContest(api, {
      key: `quotasrc${(counter += 1)}`,
      authors: [editorId],
      isOrganizationPrivate: true,
      organizations: [organization._id],
    });
    await post(
      { key: `quotacl${counter}` },
      contestUrl(source.key, '/clone'),
    ).expect(201);
    expect(await usedBy(organization._id)).toBe(20);
    const refusedKey = `quotacl2${counter}`;
    await post({ key: refusedKey }, contestUrl(source.key, '/clone'))
      .expect(403)
      .expect(errorCode('quota_exceeded'));
    expect(await api.contests.countDocuments({ key: refusedKey })).toBe(0);
  });

  describe('an edit that scopes a contest to an organization', () => {
    const patch = (key: string, body: object) =>
      authed(api.http().patch(contestUrl(key)), editor).send(body);
    const owned = (extra: Record<string, unknown> = {}) =>
      createContest(api, {
        key: `quotaedit${(counter += 1)}`,
        authors: [editorId],
        ...extra,
      });

    it('charges the first listed organization when a public contest is made private', async () => {
      const first = await limited(100);
      const second = await limited(100);
      const contest = await owned();
      await patch(contest.key, {
        isOrganizationPrivate: true,
        organizations: [first._id, second._id],
      }).expect(200);
      expect(await usedBy(first._id)).toBe(20);
      expect(await usedBy(second._id)).toBeNull();
      const entries = await ledger.find({ organization: first._id }).lean();
      expect(entries.map(({ reason, ref }) => [reason, ref])).toEqual([
        ['contest', contest.key],
      ]);
    });

    it('refuses at the limit and leaves the contest public', async () => {
      const organization = await limited(10);
      const contest = await owned();
      await patch(contest.key, {
        isOrganizationPrivate: true,
        organizations: [organization._id],
      })
        .expect(403)
        .expect(errorCode('quota_exceeded'));
      const stored = await api.contests.findOne({ key: contest.key }).lean();
      expect(stored?.isOrganizationPrivate).toBe(false);
    });

    it('charges once when two edits scope the same contest at the same time', async () => {
      const organization = await limited(100);
      const contest = await owned();
      const contests = api.app.get(ContestsRepository);
      const write = contests.update.bind(contests);
      const overtaken = jest
        .spyOn(contests, 'update')
        .mockImplementationOnce(async (...args) => {
          // The other editor's edit lands first and scopes the contest (and is charged).
          await api.contests.updateOne(
            { key: contest.key },
            { isOrganizationPrivate: true, organizations: [organization._id] },
          );
          return write(...args);
        });
      await patch(contest.key, {
        isOrganizationPrivate: true,
        organizations: [organization._id],
      })
        .expect(409)
        .expect(errorCode('conflict'));
      overtaken.mockRestore();
      expect(await usedBy(organization._id)).toBe(0);
    });

    it('refunds when a problem added by the save was deleted meanwhile and the save is undone', async () => {
      const organization = await limited(100);
      const contest = await owned();
      const problem = await createProblem(api, await seedCatalog(api), {
        code: `quotagone${counter}`,
        isPublic: true,
      });
      const contests = api.app.get(ContestsRepository);
      const write = contests.update.bind(contests);
      const overtaken = jest
        .spyOn(contests, 'update')
        .mockImplementationOnce(async (...args) => {
          await softDelete(api, problem._id);
          return write(...args);
        });
      await patch(contest.key, {
        isOrganizationPrivate: true,
        organizations: [organization._id],
        problems: [{ problem: problem._id, points: 1 }],
      })
        .expect(400)
        .expect(errorCode('validation_failed'));
      overtaken.mockRestore();
      const stored = await api.contests.findOne({ key: contest.key }).lean();
      expect([stored?.isOrganizationPrivate, stored?.problems]).toEqual([
        false,
        [],
      ]);
      expect(await usedBy(organization._id)).toBe(0);
    });
  });
});

describe('problem creation quota', () => {
  let catalog: Catalog;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  let editorId: string;
  let editor: TestSession;
  let counter = 0;
  const PROBLEMS = '/api/internal/problems';
  const payload = (extra: Record<string, unknown> = {}) => {
    counter += 1;
    return {
      code: `quota${counter}`,
      name: 'Quota',
      description: 'text',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      typeIds: [catalog.types.uncategorized],
      groupId: catalog.groups.uncategorized,
      ...extra,
    };
  };
  const orgPayload = (organizations: string[]) =>
    payload({ isOrganizationPrivate: true, organizations });
  const post = (session: TestSession, body: object, path = PROBLEMS) =>
    authed(api.http().post(path), session).send(body);
  const usedBy = async (organizationId: string) =>
    (await usage.findOne({ organization: organizationId }).lean())
      ?.creditsUsed ?? null;
  const limited = (credits: number) =>
    createOrganization(api, { quotaMonthlyCredits: credits });

  beforeAll(async () => {
    await api.reset();
    catalog = await seedCatalog(api);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    editorId = (
      await createUserWith(api, 'quotaeditor', {
        permissions: [
          'judge.add_problem',
          'judge.edit_own_problem',
          'judge.edit_all_problem',
          'judge.clone_problem',
        ],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  beforeEach(async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  });

  it('charges the first listed organization of a new organization problem', async () => {
    const first = await limited(100);
    const second = await limited(100);
    const body = orgPayload([first._id, second._id]);
    await post(editor, body).expect(201);
    expect(await usedBy(first._id)).toBe(10);
    expect(await usedBy(second._id)).toBeNull();
    const entries = await ledger.find({ organization: first._id }).lean();
    expect(
      entries.map(({ reason, amount, ref }) => [reason, amount, ref]),
    ).toEqual([['problem', 10, body.code]]);
  });

  it('records the revision once even when the warning read fails', async () => {
    const organization = await limited(100);
    const reading = jest
      .spyOn(api.app.get(QuotaService), 'creditsUsed')
      .mockRejectedValueOnce(new Error('mongo blip'));
    const appended = jest.spyOn(api.app.get(RevisionsRepository), 'append');
    const body = orgPayload([organization._id]);
    await post(editor, body).expect(201);
    reading.mockRestore();
    expect(appended).toHaveBeenCalledTimes(1);
    appended.mockRestore();
    expect(await usedBy(organization._id)).toBe(10);
    expect(
      await ledger.countDocuments({ organization: organization._id }),
    ).toBe(1);
  });

  it('refuses creation at the limit, creates nothing and leaves the counter alone', async () => {
    const organization = await limited(15);
    await post(editor, orgPayload([organization._id])).expect(201);
    const refused = orgPayload([organization._id]);
    await post(editor, refused).expect(403).expect(errorCode('quota_exceeded'));
    expect(await api.problems.countDocuments({ code: refused.code })).toBe(0);
    expect(await usedBy(organization._id)).toBe(10);
  });

  it('refunds the credits when the code is already taken', async () => {
    const organization = await limited(100);
    await createProblem(api, catalog, { code: 'takenquota' });
    await post(editor, {
      ...orgPayload([organization._id]),
      code: 'takenquota',
    }).expect(400);
    expect(await usedBy(organization._id)).toBe(0);
    const entries = await ledger
      .find({ organization: organization._id })
      .sort({ _id: 1 })
      .lean();
    expect(entries.map(({ reason, amount }) => [reason, amount])).toEqual([
      ['problem', 10],
      ['refund', -10],
    ]);
  });

  it('charges a clone of an organization problem to the same organization', async () => {
    const organization = await limited(15);
    const source = await createProblem(api, catalog, {
      code: `clonesrc${(counter += 1)}`,
      isOrganizationPrivate: true,
      organizations: [organization._id],
      authors: [editorId],
    });
    await post(
      editor,
      { code: `clonea${counter}` },
      `${PROBLEMS}/${source.code}/clone`,
    ).expect(201);
    expect(await usedBy(organization._id)).toBe(10);
    const refusedCode = `cloneb${counter}`;
    await post(
      editor,
      { code: refusedCode },
      `${PROBLEMS}/${source.code}/clone`,
    )
      .expect(403)
      .expect(errorCode('quota_exceeded'));
    expect(await api.problems.countDocuments({ code: refusedCode })).toBe(0);
  });
});

const PROBLEMS = '/api/internal/problems';
const tests = (count: number) =>
  Array.from({ length: count }, (_item, index) => [
    { name: `${index + 1}.in`, content: 'in' },
    { name: `${index + 1}.out`, content: 'out' },
  ]).flat();

describe('problem data quota', () => {
  let catalog: Catalog;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  let polygon: Queue;
  let authorId: string;
  let author: TestSession;
  let counter = 0;
  const notify = jest.fn(() => Promise.resolve());
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
    await api.reset();
    jest
      .spyOn(api.app.get(NotificationsService), 'notify')
      .mockImplementation(notify);
    catalog = await seedCatalog(api);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    polygon = api.app.get(getQueueToken(POLYGON_QUEUE));
    authorId = (
      await createUserWith(api, 'dqauthor', {
        permissions: [
          'judge.edit_own_problem',
          'judge.create_organization_problem',
        ],
      })
    )._id;
    author = await loginAs(api, authorId);
  });
  beforeEach(async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  });
  afterAll(() => jest.restoreAllMocks());

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

  describe('the PDF statement and the material', () => {
    const pdfOf = (bytes: number) =>
      Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(bytes - 5, 'x')]);
    const uploadFile = (
      code: string,
      kind: 'statement' | 'material',
      content: Buffer,
    ) =>
      authed(api.http().post(`${PROBLEMS}/${code}/${kind}`), author).attach(
        'file',
        content,
        {
          filename: kind === 'statement' ? 'de.pdf' : 'de.docx',
          contentType: 'application/octet-stream',
        },
      );
    const usedBytes = (organizationId: string) =>
      api.app.get(ProblemsRepository).sumStoredBytes(organizationId);

    it('count against the storage limit; a replaced or removed file gives its bytes back', async () => {
      const { organization, problem } = await orgProblem(
        {},
        { quotaStorageBytes: 1000, adminIds: [authorId] },
      );
      await uploadFile(problem.code, 'statement', pdfOf(600)).expect(201);
      expect(await usedBytes(organization._id)).toBe(600);
      // 600 + 700 would not fit: only the 100 extra bytes of the replacement are charged.
      await uploadFile(problem.code, 'statement', pdfOf(700)).expect(201);
      expect(await usedBytes(organization._id)).toBe(700);
      const refused = await uploadFile(
        problem.code,
        'material',
        Buffer.alloc(400, 'x'),
      )
        .expect(403)
        .expect(errorCode('quota_exceeded'));
      expect(
        (refused.body as { error: { details: unknown } }).error.details,
      ).toEqual({ meter: 'storage', limit: 1000, used: 700, needed: 400 });
      expect(
        existsSync(join(api.mediaRoot, 'materials', String(problem._id))),
      ).toBe(false);
      await authed(
        api.http().delete(`${PROBLEMS}/${problem.code}/statement`),
        author,
      ).expect(204);
      expect(await usedBytes(organization._id)).toBe(0);
      await uploadFile(problem.code, 'material', Buffer.alloc(400, 'x')).expect(
        201,
      );
      expect(await usedBytes(organization._id)).toBe(400);
      expect(await creditsOf(organization._id)).toBe(0);
    });
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

  describe('a Polygon import that creates an organization problem', () => {
    const IMPORT_PACKAGE = buildZip([
      { name: 'problem.xml', content: '<problem/>' },
      { name: 'tests/01', content: '1'.repeat(200) },
    ]);
    const importInto = (slug: string, code: string) =>
      authed(
        api
          .http()
          .post(`${PROBLEMS}/imports?code=${code}&organization=${slug}`),
        author,
      ).attach('file', IMPORT_PACKAGE, {
        filename: 'package.zip',
        contentType: 'application/zip',
      });
    const storedPackages = () =>
      readdirSync(join(api.problemDataRoot, '.imports'));
    const waitingJobs = async () =>
      (await polygon.getJobs(['waiting', 'active'])).length;
    const administered = (quota: Record<string, unknown>) => {
      counter += 1;
      return createOrganization(api, {
        slug: `imp${counter}`,
        adminIds: [authorId],
        ...quota,
      });
    };

    beforeEach(() => api.setSetting('quota.cost.problem', 10));

    it('spends the problem price when the job is queued', async () => {
      const organization = await administered({ quotaMonthlyCredits: 30 });
      await importInto(organization.slug, `${organization.slug}_a`).expect(202);
      expect(await creditsOf(organization._id)).toBe(10);
    });

    it('refuses at the credit limit, queuing no job, keeping no package and leaving the counter alone', async () => {
      const organization = await administered({ quotaMonthlyCredits: 5 });
      const before = await waitingJobs();
      const packages = storedPackages().length;
      await importInto(organization.slug, `${organization.slug}_a`)
        .expect(403)
        .expect(errorCode('quota_exceeded'));
      expect(await waitingJobs()).toBe(before);
      expect(storedPackages()).toHaveLength(packages);
      expect(await creditsOf(organization._id)).toBe(0);
    });

    it('refuses a package over the storage limit before spending credits', async () => {
      const organization = await administered({ quotaStorageBytes: 20 });
      await importInto(organization.slug, `${organization.slug}_a`)
        .expect(403)
        .expect(errorCode('quota_exceeded'));
      expect(await creditsOf(organization._id)).toBe(0);
    });
  });
});

interface Draft {
  kind: string;
  groupKey: string;
  path: string;
}

describe('quota 80 percent warning', () => {
  let quota: QuotaService;
  const sent: Array<{ recipients: string[]; draft: Draft }> = [];
  const fake = {
    notify: jest.fn((recipients: string[], draft: Draft) => {
      sent.push({ recipients, draft });
      return Promise.resolve();
    }),
  };
  const request = {
    kind: 'problem' as const,
    userId: '0190a000-0000-7000-8000-000000000001',
    ref: 'r',
  };
  const spend = (organizationId: string, now?: Date) =>
    quota.charged(organizationId, request, () => Promise.resolve(1), now);

  beforeAll(async () => {
    await api.reset();
    jest
      .spyOn(api.app.get(NotificationsService), 'notify')
      .mockImplementation(fake.notify as never);
    quota = api.app.get(QuotaService);
    await api.setSetting('quota.cost.problem', 1);
  });
  beforeEach(() => {
    sent.length = 0;
    fake.notify.mockClear();
  });
  afterAll(() => jest.restoreAllMocks());

  it('tells the organization admins once, when credits first reach 80 percent of the month', async () => {
    const admin = '0190a000-0000-7000-8000-0000000000aa';
    const organization = await createOrganization(api, {
      adminIds: [admin],
      quotaMonthlyCredits: 10,
    });
    for (let count = 0; count < 7; count += 1) await spend(organization._id);
    expect(sent).toHaveLength(0);
    await spend(organization._id);
    await spend(organization._id);
    expect(sent).toHaveLength(1);
    expect(sent[0].recipients).toEqual([admin]);
    expect(sent[0].draft).toMatchObject({
      kind: 'quota-warning',
      path: `/organizations/${organization.slug}`,
    });
  });

  it('warns about storage once, when it first reaches 80 percent', async () => {
    const admin = '0190a000-0000-7000-8000-0000000000bb';
    const organization = await createOrganization(api, {
      adminIds: [admin],
      quotaStorageBytes: 1000,
    });
    await quota.afterStorageWrite(organization._id, 700);
    expect(sent).toHaveLength(0);
    await quota.afterStorageWrite(organization._id, 850);
    expect(sent).toHaveLength(1);
    expect(sent[0].recipients).toEqual([admin]);
    expect(sent[0].draft.groupKey).toContain('storage');
    await quota.afterStorageWrite(organization._id, 900);
    expect(sent).toHaveLength(1);
  });

  it('never lets a failing warning read fail finished work, and charges once', async () => {
    const organization = await createOrganization(api, {
      adminIds: ['0190a000-0000-7000-8000-0000000000ee'],
      quotaMonthlyCredits: 10,
      quotaStorageBytes: 1000,
    });
    const reading = jest
      .spyOn(quota, 'creditsUsed')
      .mockRejectedValueOnce(new Error('mongo blip'));
    await expect(spend(organization._id)).resolves.toBe(1);
    expect(
      await quota.creditsUsed({
        organizationId: organization._id,
        month: quota.monthKeyOf(new Date()),
      }),
    ).toBe(1);
    reading.mockRestore();
    const limits = jest
      .spyOn(quota, 'limitsOf')
      .mockRejectedValueOnce(new Error('mongo blip'));
    await expect(
      quota.afterStorageWrite(organization._id, 900),
    ).resolves.toBeUndefined();
    limits.mockRestore();
    const sizing = jest.fn().mockRejectedValueOnce(new Error('sum failed'));
    await expect(
      quota.afterStorageWrite(organization._id, sizing),
    ).resolves.toBeUndefined();
  });
});
