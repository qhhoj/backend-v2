import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QuotaService } from '../src/modules/organizations/quota/quota.service';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { createOrganization } from './organization-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('organization quota', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
    quota = api.app.get(QuotaService);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    await api.setSetting('quota.cost.problem', 10);
  });
  beforeEach(enforce);
  afterAll(() => api.teardown());

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
