import { Logger } from '@nestjs/common';
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

  it('reports the meter, limit, used and needed in the refusal', async () => {
    const organization = await limited(15);
    await quota.charged(organization._id, request(), () => Promise.resolve(1));
    await expect(
      quota.charged(organization._id, request(), () => Promise.resolve(1)),
    ).rejects.toMatchObject({
      extra: { details: { meter: 'credits', limit: 15, used: 10, needed: 10 } },
    });
  });

  it('refuses a first spend that costs more than the limit and writes no row', async () => {
    const organization = await limited(5);
    await expect(
      quota.charged(organization._id, request(), () => Promise.resolve('made')),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await usage.countDocuments({ organization: organization._id })).toBe(
      0,
    );
  });

  it('answers quota_exceeded, not a duplicate-key error, for a month already over the limit', async () => {
    const organization = await limited(100);
    await usage.create({
      organization: organization._id,
      month: quota.monthKeyOf(new Date()),
      creditsUsed: 150,
    });
    await expect(
      quota.charged(organization._id, request(), () => Promise.resolve('made')),
    ).rejects.toMatchObject({ code: 'quota_exceeded', status: 403 });
    expect(await usedBy(organization._id)).toBe(150);
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

  it('uses the site default when the organization has no limit of its own', async () => {
    const organization = await createOrganization(api);
    await api.setSetting('quota.defaultMonthlyCredits', 10);
    await quota.charged(organization._id, request(), () => Promise.resolve(1));
    await expect(
      quota.charged(organization._id, request(), () => Promise.resolve(1)),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    await api.setSetting('quota.defaultMonthlyCredits', 200);
  });

  it('charges an upload per 10 MiB started and a contest at its own price', async () => {
    const organization = await limited(100);
    const twentyOneMiB = 21 * 1024 * 1024;
    await quota.charged(
      organization._id,
      { ...request(), kind: 'upload', bytes: twentyOneMiB },
      () => Promise.resolve(1),
    );
    expect(await usedBy(organization._id)).toBe(3);
    await quota.charged(organization._id, request('contest'), () =>
      Promise.resolve(1),
    );
    expect(await usedBy(organization._id)).toBe(23);
  });

  it('runs free work for a null organization and for a zero price', async () => {
    await expect(
      quota.charged(null, request(), () => Promise.resolve('free')),
    ).resolves.toBe('free');
    const organization = await limited(1);
    await quota.charged(
      organization._id,
      { kind: 'upload', userId, ref: '', bytes: 0 },
      () => Promise.resolve(1),
    );
    expect(await usage.countDocuments({ organization: organization._id })).toBe(
      0,
    );
  });

  it('warns at boot when enforce is set but the backfill flag is missing', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).del(QUOTA_BACKFILL_DONE_KEY);
    await quota.onApplicationBootstrap();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('backfill'));
    warning.mockClear();
    await enforce();
    await quota.onApplicationBootstrap();
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
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
    it('stays in warn mode when enforce is set but the backfill has not finished', async () => {
      await api.setSetting('quota.enforce', 'enforce');
      expect(await quota.isEnforcing()).toBe(false);
      const organization = await limited(5);
      await expect(
        quota.charged(organization._id, request(), () =>
          Promise.resolve('made'),
        ),
      ).resolves.toBe('made');
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
    it('always lets a write that does not grow storage through', async () => {
      const organization = await createOrganization(api, {
        quotaStorageBytes: 10,
      });
      await expect(
        quota.assertStorage(organization._id, {
          usedBytes: 999,
          addedBytes: -5,
        }),
      ).resolves.toBeUndefined();
    });
    it('only warns in warn mode', async () => {
      await warn();
      const organization = await createOrganization(api, {
        quotaStorageBytes: 10,
      });
      await expect(
        quota.assertStorage(organization._id, {
          usedBytes: 999,
          addedBytes: 1,
        }),
      ).resolves.toBeUndefined();
    });
  });

  it('snapshots both meters with the 80 percent flag', async () => {
    const organization = await createOrganization(api, {
      quotaMonthlyCredits: 100,
      quotaStorageBytes: 1000,
    });
    await usage.create({
      organization: organization._id,
      month: quota.monthKeyOf(new Date()),
      creditsUsed: 80,
    });
    const snapshot = await quota.snapshot(organization._id, 500);
    expect(snapshot.credits).toEqual({
      used: 80,
      limit: 100,
      isNearLimit: true,
      isOver: false,
    });
    expect(snapshot.storage).toEqual({
      used: 500,
      limit: 1000,
      isNearLimit: false,
      isOver: false,
    });
    expect(snapshot.enforcing).toBe(true);
  });
});
