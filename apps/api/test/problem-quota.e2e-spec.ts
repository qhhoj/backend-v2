import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
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

describe('problem creation quota', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  let editorId: string;
  let editor: TestSession;
  let superuser: TestSession;
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
  const totalCredits = async () =>
    (
      await usage.aggregate<{ sum: number }>([
        { $group: { _id: null, sum: { $sum: '$creditsUsed' } } },
      ])
    )[0]?.sum ?? 0;

  beforeAll(async () => {
    api = await setupApiTest();
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
    superuser = await loginAs(
      api,
      (await createUserWith(api, 'quotaroot', { isSuperuser: true }))._id,
    );
  });
  beforeEach(async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  });
  afterAll(() => api.teardown());

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

  it('does not charge a request that fails validation', async () => {
    const organization = await limited(100);
    await post(editor, {
      ...orgPayload([organization._id]),
      timeLimit: 'fast',
    }).expect(400);
    expect(await usedBy(organization._id)).toBeNull();
  });

  it('keeps problems without an organization, and superusers, free', async () => {
    const organization = await limited(5);
    const before = await totalCredits();
    await post(editor, payload()).expect(201);
    await post(superuser, orgPayload([organization._id])).expect(201);
    expect(await totalCredits()).toBe(before);
    expect(await usedBy(organization._id)).toBeNull();
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

  it('does not charge a clone of a public problem', async () => {
    const source = await createProblem(api, catalog, {
      code: `clonepub${(counter += 1)}`,
      authors: [editorId],
    });
    const before = await totalCredits();
    await post(
      editor,
      { code: `clonepubcopy${counter}` },
      `${PROBLEMS}/${source.code}/clone`,
    ).expect(201);
    expect(await totalCredits()).toBe(before);
  });

  it('lets an over-limit creation through in warn mode and still counts it', async () => {
    await api.setSetting('quota.enforce', 'warn');
    const organization = await limited(5);
    await post(editor, orgPayload([organization._id])).expect(201);
    expect(await usedBy(organization._id)).toBe(10);
  });
});
