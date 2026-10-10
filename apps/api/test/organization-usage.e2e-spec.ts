import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { QuotaService } from '../src/modules/organizations/quota/quota.service';
import { createOrganization } from './organization-fixtures';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Meter {
  used: number;
  limit: number;
  isNearLimit: boolean;
  isOver: boolean;
}
interface Usage {
  organization: { slug: string };
  credits: Meter;
  storage: Meter;
  quota: { monthlyCredits: number | null; storageBytes: number | null };
  recent: Array<{
    reason: string;
    amount: number;
    actor: { id: string; username: string } | null;
  }>;
}

describe('organization usage', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let usage: Model<OrganizationUsage>;
  let ledger: Model<OrganizationCreditEntry>;
  let month: string;
  let counter = 0;
  const get = (path: string, session: TestSession) =>
    authed(api.http().get(path), session);
  const usageUrl = (slug: string) =>
    `/api/internal/organizations/${slug}/usage`;
  const staff = async () => {
    counter += 1;
    const user = await createUserWith(api, `quotastaff${counter}`, {
      permissions: ['judge.edit_all_organization'],
    });
    return loginAs(api, user._id);
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    month = api.app.get(QuotaService).monthKeyOf(new Date());
  });
  afterAll(() => api.teardown());

  it('shows an organization admin the credits, storage and recent spends', async () => {
    const world = await seedOrganizationWorld(api, {
      quotaMonthlyCredits: 100,
      quotaStorageBytes: 1000,
    });
    await usage.create({
      organization: world.organization._id,
      month,
      creditsUsed: 80,
    });
    const entry = (extra: object) =>
      ledger.create({
        organization: world.organization._id,
        month,
        ref: 'p1',
        ...extra,
      });
    await entry({ reason: 'problem', amount: 10 });
    await entry({ reason: 'refund', amount: -10 });
    counter += 1;
    await createProblem(api, catalog, {
      code: `use${counter}`,
      isOrganizationPrivate: true,
      organizations: [world.organization._id],
      dataBytes: 900,
    });
    const body = dataOf<Usage>(
      await get(usageUrl(world.organization.slug), world.admin.session).expect(
        200,
      ),
    );
    expect(body.credits).toEqual({
      used: 80,
      limit: 100,
      isNearLimit: true,
      isOver: false,
    });
    expect(body.storage).toEqual({
      used: 900,
      limit: 1000,
      isNearLimit: true,
      isOver: false,
    });
    expect(body.quota).toEqual({ monthlyCredits: 100, storageBytes: 1000 });
    expect(body.recent.map((item) => [item.reason, item.amount])).toEqual([
      ['refund', -10],
      ['problem', 10],
    ]);
  });

  it.each(['enforce', 'warn'])(
    'reports both meters full and over at limit 0 with nothing used (%s mode)',
    async (mode) => {
      await api.setSetting('quota.enforce', mode);
      const redis = api.app.get<Redis>(REDIS);
      if (mode === 'enforce') await redis.set(QUOTA_BACKFILL_DONE_KEY, '1');
      else await redis.del(QUOTA_BACKFILL_DONE_KEY);
      const world = await seedOrganizationWorld(api, {
        quotaMonthlyCredits: 0,
        quotaStorageBytes: 0,
      });
      const body = dataOf<Usage>(
        await get(
          usageUrl(world.organization.slug),
          world.admin.session,
        ).expect(200),
      );
      const full = { used: 0, limit: 0, isNearLimit: true, isOver: true };
      expect(body.credits).toEqual(full);
      expect(body.storage).toEqual(full);
    },
  );

  it('names who spent each credit entry, and gives null for a system entry or a user that vanished', async () => {
    const world = await seedOrganizationWorld(api);
    counter += 1;
    const spender = await createUserWith(api, `spender${counter}`);
    const entry = (extra: object) =>
      ledger.create({
        organization: world.organization._id,
        month,
        ref: 'p1',
        ...extra,
      });
    await entry({ reason: 'problem', amount: 10, user: spender._id });
    await entry({ reason: 'refund', amount: -10, user: null });
    await entry({
      reason: 'upload',
      amount: 3,
      user: '00000000-0000-7000-8000-00000000dead',
    });
    const body = dataOf<Usage>(
      await get(usageUrl(world.organization.slug), world.admin.session).expect(
        200,
      ),
    );
    expect(body.recent.map((item) => [item.reason, item.actor])).toEqual([
      ['upload', null],
      ['refund', null],
      ['problem', { id: spender._id, username: spender.username }],
    ]);
  });

  it('uses the site defaults when the organization has no caps, and refuses members and outsiders', async () => {
    const world = await seedOrganizationWorld(api);
    const { slug } = world.organization;
    const body = dataOf<Usage>(
      await get(usageUrl(slug), world.admin.session).expect(200),
    );
    expect(body.credits).toMatchObject({ used: 0, limit: 200 });
    expect(body.storage.limit).toBe(536_870_912);
    expect(body.quota).toEqual({ monthlyCredits: null, storageBytes: null });
    await get(usageUrl(slug), world.member.session)
      .expect(403)
      .expect(errorCode('forbidden'));
    await get(usageUrl(slug), world.outsider.session).expect(403);
  });

  it('lets only edit_all_organization change a quota, and null goes back to the default', async () => {
    const world = await seedOrganizationWorld(api);
    const path = `/api/internal/organizations/${world.organization.slug}/quota`;
    const patch = (body: object, session: TestSession) =>
      authed(api.http().patch(path), session).send(body);
    await patch({ quotaMonthlyCredits: 5 }, world.admin.session)
      .expect(403)
      .expect(errorCode('forbidden'));
    const session = await staff();
    const log = jest.spyOn(Logger.prototype, 'log');
    const changed = dataOf<Usage>(
      await patch(
        { quotaMonthlyCredits: 5, quotaStorageBytes: 2048 },
        session,
      ).expect(200),
    );
    expect(changed.credits.limit).toBe(5);
    expect(changed.storage.limit).toBe(2048);
    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('organization.quota.changed'));
    log.mockRestore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      organization: world.organization._id,
      after: { quotaMonthlyCredits: 5, quotaStorageBytes: 2048 },
    });
    const reset = dataOf<Usage>(
      await patch({ quotaMonthlyCredits: null }, session).expect(200),
    );
    expect(reset.credits.limit).toBe(200);
    expect(reset.storage.limit).toBe(2048);
    await patch({ quotaMonthlyCredits: -1 }, session).expect(400);
  });

  it('lets staff end and restore the unlimited promotion; the meters are never near or over while it lasts', async () => {
    const organization = await createOrganization(api, {
      quotaUnlimited: true,
      quotaMonthlyCredits: 10,
    });
    await usage.create({
      organization: organization._id,
      month,
      creditsUsed: 50,
    });
    const session = await staff();
    const path = `/api/internal/organizations/${organization.slug}/quota`;
    const show = async () =>
      dataOf<Usage & { unlimited: boolean }>(
        await get(
          `/api/internal/organizations/${organization.slug}/usage`,
          session,
        ).expect(200),
      );
    expect(await show()).toMatchObject({
      unlimited: true,
      credits: { limit: 10, used: 50, isOver: false, isNearLimit: false },
    });
    const ended = await authed(api.http().patch(path), session)
      .send({ quotaUnlimited: false })
      .expect(200);
    expect(dataOf<Usage>(ended)).toMatchObject({
      unlimited: false,
      credits: { isOver: true },
    });
    const rows = dataOf<Array<{ slug: string; unlimited: boolean }>>(
      await get(
        '/api/internal/organizations/usage?pageSize=100',
        session,
      ).expect(200),
    );
    expect(rows.find((row) => row.slug === organization.slug)?.unlimited).toBe(
      false,
    );
    await authed(api.http().patch(path), session)
      .send({ quotaUnlimited: 'yes' })
      .expect(400);
  });

  it('keeps the unlimited toggle away from organization admins', async () => {
    const world = await seedOrganizationWorld(api);
    await authed(
      api
        .http()
        .patch(`/api/internal/organizations/${world.organization.slug}/quota`),
      world.admin.session,
    )
      .send({ quotaUnlimited: true })
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('lists every organization for staff, heaviest spender first when asked', async () => {
    const quiet = await createOrganization(api, { name: 'AAA quiet' });
    const busy = await createOrganization(api, { name: 'ZZZ busy' });
    await usage.create({
      organization: busy._id,
      month,
      creditsUsed: 150,
    });
    const session = await staff();
    const rows = async (query: string) =>
      dataOf<Array<{ slug: string; creditsUsed: number }>>(
        await get(`/api/internal/organizations/usage${query}`, session).expect(
          200,
        ),
      );
    const byName = (await rows('?pageSize=100')).map((row) => row.slug);
    expect(byName.indexOf(quiet.slug)).toBeLessThan(byName.indexOf(busy.slug));
    const byCredits = await rows('?sort=credits&pageSize=100');
    expect(byCredits[0]).toMatchObject({ slug: busy.slug, creditsUsed: 150 });
    expect(byCredits.map((row) => row.slug)).toContain(quiet.slug);
    await get('/api/internal/organizations/usage?sort=bogus', session).expect(
      400,
    );
  });

  it('keeps the staff overview away from organization admins', async () => {
    const world = await seedOrganizationWorld(api);
    await get('/api/internal/organizations/usage', world.admin.session).expect(
      403,
    );
  });
});
