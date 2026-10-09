import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { ContestsRepository } from '../src/modules/contests/core/contests.repository';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { createOrganization } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest quota', () => {
  let api: ApiTest;
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
    createOrganization(api, { quotaMonthlyCredits: credits });

  beforeAll(async () => {
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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

  it('keeps a contest without an organization free', async () => {
    const before = await usage.countDocuments({});
    await post(newContest()).expect(201);
    expect(await usage.countDocuments({})).toBe(before);
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

  it('lets an over-limit contest through in warn mode', async () => {
    await api.setSetting('quota.enforce', 'warn');
    const organization = await limited(5);
    await post(orgContest([organization._id])).expect(201);
    expect(await usedBy(organization._id)).toBe(20);
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

    it('does not charge a contest that was already organization-private', async () => {
      const first = await limited(100);
      const second = await limited(100);
      const contest = await owned({
        isOrganizationPrivate: true,
        organizations: [first._id],
      });
      await patch(contest.key, { name: 'Renamed' }).expect(200);
      await patch(contest.key, { organizations: [second._id] }).expect(200);
      expect(await usedBy(first._id)).toBeNull();
      expect(await usedBy(second._id)).toBeNull();
    });

    it('refunds when the save fails', async () => {
      const organization = await limited(100);
      const contest = await owned();
      const failing = jest
        .spyOn(api.app.get(ContestsRepository), 'update')
        .mockRejectedValueOnce(new Error('mongo blip'));
      await patch(contest.key, {
        isOrganizationPrivate: true,
        organizations: [organization._id],
      }).expect(500);
      failing.mockRestore();
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
  });
});
