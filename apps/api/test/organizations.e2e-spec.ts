import type { User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type {
  OrganizationDetailResponse,
  OrganizationListItemResponse,
} from '../src/modules/organizations/core/dto/organization.response';
import type { MemberResponse } from '../src/modules/organizations/core/dto/member.response';
import { createOrganization, organizationUrl } from './organization-fixtures';
import {
  authed,
  createUserWith,
  loginAs,
  createProblem,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession, Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest, errorCode } from './setup';
import type { ApiTest } from './setup';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import {
  OrganizationCreditEntry,
  OrganizationUsage,
  uuidStr,
} from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { QuotaService } from '../src/modules/organizations/quota/quota.service';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  clearOrganizationPointsPending,
  ORGANIZATION_POINTS_JOB,
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import { Queue as BullQueue } from 'bullmq';
import type { OrganizationPointsJob } from '@libs/community';
import { OrganizationPointsService } from '../src/modules/organizations/core/organization-points.service';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from organizations.e2e-spec.ts
{
  describe('organizations', () => {
    beforeAll(() => api.reset());
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const get = (url: string, session?: TestSession) =>
      session ? authed(api.http().get(url), session) : api.http().get(url);

    beforeAll(async () => {
      const roles: Array<[string, Partial<User>]> = [
        ['admin', {}],
        ['member', {}],
        ['outsider', {}],
        ['staff', { permissions: ['judge.edit_all_organization'] }],
      ];
      for (const [name, extra] of roles) {
        users[name] = await createUserWith(api, name, extra);
        sessions[name] = await loginAs(api, users[name]._id);
      }
      await createOrganization(
        api,
        {
          name: 'Alpha',
          slug: 'alpha',
          about: 'raw',
          aboutHtml: '<p>raw</p>',
          adminIds: [users.admin._id],
        },
        [users.member._id],
      );
      await createOrganization(
        api,
        { name: 'Beta', slug: 'beta', isUnlisted: true },
        [users.member._id],
      );
    });

    it('lists unlisted organizations only to their members and edit_all_organization', async () => {
      const slugsFor = async (session?: TestSession) =>
        dataOf<OrganizationListItemResponse[]>(
          await get('/api/internal/organizations', session).expect(200),
        ).map((item) => item.slug);
      expect(await slugsFor()).toEqual(['alpha']);
      expect(await slugsFor(sessions.outsider)).toEqual(['alpha']);
      expect(await slugsFor(sessions.member)).toEqual(['alpha', 'beta']);
      expect(await slugsFor(sessions.staff)).toEqual(['alpha', 'beta']);
    });

    it('serves an unlisted organization by its slug, case-insensitively', async () => {
      await get(organizationUrl('nope'), sessions.outsider).expect(404);
      expect(
        dataOf<OrganizationDetailResponse>(
          await get(organizationUrl('BETA'), sessions.outsider).expect(200),
        ).slug,
      ).toBe('beta');
      await get(organizationUrl('beta', '/members')).expect(200);
    });

    it('shows the raw about and the viewer facts only to whom they belong', async () => {
      const asAdmin = dataOf<OrganizationDetailResponse>(
        await get(organizationUrl('alpha'), sessions.admin).expect(200),
      );
      expect(asAdmin).toMatchObject({
        slug: 'alpha',
        aboutHtml: '<p>raw</p>',
        about: 'raw',
        viewer: { isMember: true, canAdminister: true },
      });
      expect(asAdmin.admins.map((admin) => admin.username)).toEqual(['admin']);
      const asOutsider = dataOf<OrganizationDetailResponse>(
        await get(organizationUrl('alpha'), sessions.outsider).expect(200),
      );
      expect(asOutsider.about).toBeNull();
      expect(asOutsider.viewer).toMatchObject({
        isMember: false,
        canAdminister: false,
      });
      expect(
        dataOf<OrganizationDetailResponse>(
          await get(organizationUrl('alpha')).expect(200),
        ).viewer,
      ).toBeNull();
    });

    it('lists listed members ranked like legacy ranker, page 2 continuing page 1', async () => {
      const organization = await createOrganization(api, { slug: 'ranked' });
      const points = [90, 80, 80, 80, 70];
      for (const [index, performancePoints] of points.entries())
        await createUserWith(api, `ranked${index}`, {
          organizations: [organization._id],
          performancePoints,
        });
      await createUserWith(api, 'ranked_hidden', {
        organizations: [organization._id],
        performancePoints: 100,
        isUnlisted: true,
      });
      const page = async (number: number) =>
        dataOf<MemberResponse[]>(
          await get(
            organizationUrl('ranked', `/members?pageSize=2&page=${number}`),
          ).expect(200),
        );
      expect((await page(1)).map((row) => [row.username, row.rank])).toEqual([
        ['ranked0', 1],
        ['ranked1', 2],
      ]);
      expect((await page(2)).map((row) => [row.username, row.rank])).toEqual([
        ['ranked2', 2],
        ['ranked3', 2],
      ]);
      expect((await page(3)).map((row) => [row.username, row.rank])).toEqual([
        ['ranked4', 5],
      ]);
    });

    it('sorts members by another field on request', async () => {
      const organization = await createOrganization(api, { slug: 'sorted' });
      await createUserWith(api, 'sorted_a', {
        organizations: [organization._id],
        performancePoints: 10,
        problemCount: 3,
      });
      await createUserWith(api, 'sorted_b', {
        organizations: [organization._id],
        performancePoints: 20,
        problemCount: 1,
      });
      const rows = dataOf<MemberResponse[]>(
        await get(
          organizationUrl('sorted', '/members?sort=problemCount'),
        ).expect(200),
      );
      expect(rows.map((row) => row.username)).toEqual(['sorted_a', 'sorted_b']);
      await get(organizationUrl('sorted', '/members?sort=password')).expect(
        400,
      );
    });

    it('lists an unlisted organization to its admin even when not a member', async () => {
      await createOrganization(api, {
        slug: 'adminonly',
        isUnlisted: true,
        adminIds: [users.outsider._id],
      });
      await api.users.updateOne(
        { _id: users.outsider._id },
        { $set: { organizations: [] } },
      );
      const slugs = dataOf<OrganizationListItemResponse[]>(
        await get('/api/internal/organizations', sessions.outsider).expect(200),
      ).map((item) => item.slug);
      expect(slugs).toContain('adminonly');
    });

    it('reads members through the organizations index', async () => {
      const operations = await profileQueries(api.db, () =>
        get(organizationUrl('ranked', '/members')).expect(200),
      );
      const userReads = operations.filter(
        ({ collection }) => collection === 'users',
      );
      expect(userReads.length).toBeGreaterThan(0);
      expect(
        userReads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
      ).toBe(true);
      for (const sort of ['points', 'rating', 'problemCount']) {
        const sorted = await profileQueries(api.db, () =>
          get(organizationUrl('ranked', `/members?sort=${sort}`)).expect(200),
        );
        const reads = sorted.filter(({ collection }) => collection === 'users');
        expect(reads.length).toBeGreaterThan(0);
        expect(
          reads.every(({ planSummary }) =>
            planSummary.includes('organizations: 1, performancePoints: -1'),
          ),
        ).toBe(true);
      }
    });

    it('searches organizations by name, short name or slug, literally and case-insensitively, never leaking unlisted ones', async () => {
      await createOrganization(api, {
        name: 'Oxford Club',
        slug: 'club-one',
        shortName: 'Ox Club',
      });
      await createOrganization(api, {
        name: 'Other',
        slug: 'club-two',
        shortName: 'OXF',
      });
      await createOrganization(api, {
        name: 'Third',
        slug: 'oxf-slug',
        shortName: 'Third',
      });
      await createOrganization(
        api,
        { name: 'Oxford Secret', slug: 'secret-club', isUnlisted: true },
        [users.member._id],
      );
      const slugsFor = async (search: string, session?: TestSession) =>
        dataOf<OrganizationListItemResponse[]>(
          await get(
            `/api/internal/organizations?search=${search}`,
            session,
          ).expect(200),
        )
          .map((item) => item.slug)
          .sort();
      expect(await slugsFor('oxf')).toEqual([
        'club-one',
        'club-two',
        'oxf-slug',
      ]);
      expect(await slugsFor('OXF')).toEqual([
        'club-one',
        'club-two',
        'oxf-slug',
      ]);
      expect(await slugsFor('oxf', sessions.member)).toEqual([
        'club-one',
        'club-two',
        'oxf-slug',
        'secret-club',
      ]);
      expect(await slugsFor('oxf', sessions.staff)).toEqual([
        'club-one',
        'club-two',
        'oxf-slug',
        'secret-club',
      ]);
      expect(await slugsFor('oxf', sessions.outsider)).toEqual([
        'club-one',
        'club-two',
        'oxf-slug',
      ]);
    });

    it('matches the search text literally, not as a pattern', async () => {
      await createOrganization(api, { name: 'Xabc Lab', slug: 'lab-abc' });
      const slugsFor = async (search: string) =>
        dataOf<OrganizationListItemResponse[]>(
          await get(`/api/internal/organizations?search=${search}`).expect(200),
        ).map((item) => item.slug);
      expect(await slugsFor('a.c')).toEqual([]);
      expect(await slugsFor('abc')).toEqual(['lab-abc']);
      expect(await slugsFor('%20abc%20')).toEqual(['lab-abc']);
      await get('/api/internal/organizations?search=%20%20').expect(400);
      await get('/api/internal/organizations?search=').expect(400);
      await get(`/api/internal/organizations?search=${'x'.repeat(51)}`).expect(
        400,
      );
    });
  });
}

// from organization-usage.e2e-spec.ts
{
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
    beforeAll(() => api.reset());
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
      catalog = await seedCatalog(api);
      usage = api.app.get(getModelToken(OrganizationUsage.name));
      ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
      month = api.app.get(QuotaService).monthKeyOf(new Date());
    });

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
        await get(
          usageUrl(world.organization.slug),
          world.admin.session,
        ).expect(200),
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
        await get(
          usageUrl(world.organization.slug),
          world.admin.session,
        ).expect(200),
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
      expect(
        rows.find((row) => row.slug === organization.slug)?.unlimited,
      ).toBe(false);
      await authed(api.http().patch(path), session)
        .send({ quotaUnlimited: 'yes' })
        .expect(400);
    });

    it('keeps the unlimited toggle away from organization admins', async () => {
      const world = await seedOrganizationWorld(api);
      await authed(
        api
          .http()
          .patch(
            `/api/internal/organizations/${world.organization.slug}/quota`,
          ),
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
          await get(
            `/api/internal/organizations/usage${query}`,
            session,
          ).expect(200),
        );
      const byName = (await rows('?pageSize=100')).map((row) => row.slug);
      expect(byName.indexOf(quiet.slug)).toBeLessThan(
        byName.indexOf(busy.slug),
      );
      const byCredits = await rows('?sort=credits&pageSize=100');
      expect(byCredits[0]).toMatchObject({ slug: busy.slug, creditsUsed: 150 });
      expect(byCredits.map((row) => row.slug)).toContain(quiet.slug);
      await get('/api/internal/organizations/usage?sort=bogus', session).expect(
        400,
      );
    });

    it('keeps the staff overview away from organization admins', async () => {
      const world = await seedOrganizationWorld(api);
      await get(
        '/api/internal/organizations/usage',
        world.admin.session,
      ).expect(403);
    });
  });
}

// from organization-membership.e2e-spec.ts
{
  describe('organization editing and membership', () => {
    beforeAll(() => api.reset());
    let queue: Queue<OrganizationPointsJob>;
    let userCount = 0;
    const post = (url: string, session: TestSession, body: object = {}) =>
      authed(api.http().post(url), session).send(body);
    const patch = (url: string, session: TestSession, body: object) =>
      authed(api.http().patch(url), session).send(body);
    const person = async (extra: Partial<User> = {}) => {
      userCount += 1;
      const user = await createUserWith(api, `member${userCount}`, extra);
      return { user, session: await loginAs(api, user._id) };
    };
    const membershipsOf = async (userId: string) =>
      (
        (await api.users.findById(userId, { organizations: 1 }).lean())!
          .organizations ?? []
      ).map(uuidStr);
    const queuedFor = async () =>
      (await queue.getJobs(['waiting'])).map((job) => job.data.organizationId);

    beforeAll(() => {
      queue = api.app.get(getQueueToken(ORGANIZATION_POINTS_QUEUE));
    });
    beforeEach(async () => {
      await queue.drain();
      const redis = api.app.get<Redis>(REDIS);
      const pending = await redis.keys('organization-points:pending:*');
      if (pending.length) await redis.del(...pending);
    });

    it('creates an unlisted organization with the creator as admin, member and Org Admin', async () => {
      const group = await api.groups.create({
        name: 'Org Admin',
        permissions: ['judge.edit_organization_post'],
      });
      const { user, session } = await person({
        permissions: ['judge.add_organization'],
      });
      const created = dataOf<OrganizationDetailResponse>(
        await post('/api/internal/organizations', session, {
          name: 'A very long organization',
          slug: 'averyveryverylongslug_x',
          about: '<b>hi</b>',
          isOpen: true,
        }).expect(201),
      );
      expect(created).toMatchObject({
        slug: 'averyveryverylongslug_x',
        shortName: 'averyveryverylongslu',
        isUnlisted: true,
        isOpen: true,
        viewer: { isMember: true, canAdminister: true },
      });
      expect(created.aboutHtml).toContain('&lt;b&gt;hi&lt;/b&gt;');
      expect(await membershipsOf(user._id)).toEqual([created.id]);
      expect(
        (await api.users.findById(user._id).lean())!.groups.map(uuidStr),
      ).toEqual([group._id]);
      expect(await queuedFor()).toEqual([created.id]);
    });

    it('refuses create without add_organization and a slug taken in any case', async () => {
      const { session } = await person();
      await post('/api/internal/organizations', session, {
        name: 'X',
        slug: 'nope',
      })
        .expect(403)
        .expect(errorCode('forbidden'));
      const { session: creator } = await person({
        permissions: ['judge.add_organization'],
      });
      await createOrganization(api, { slug: 'taken' });
      const response = await post('/api/internal/organizations', creator, {
        name: 'X',
        slug: 'TAKEN',
      }).expect(400);
      expect(
        (response.body as { error: { fields: Record<string, string[]> } }).error
          .fields.slug,
      ).toBeDefined();
      await post('/api/internal/organizations', creator, {
        name: 'X',
        slug: '9lives',
      }).expect(400);
    });

    it('caps admin roles at three unless the acting user has spam_organization', async () => {
      const { user, session } = await person({
        permissions: ['judge.add_organization'],
      });
      for (let index = 0; index < 3; index++)
        await createOrganization(api, { adminIds: [user._id] });
      await post('/api/internal/organizations', session, {
        name: 'Fourth',
        slug: 'fourth',
      }).expect(403);
      await api.users.updateOne(
        { _id: user._id },
        { $push: { permissions: 'judge.spam_organization' } },
      );
      await post('/api/internal/organizations', session, {
        name: 'Fourth',
        slug: 'fourth',
      }).expect(201);
      const { user: busy } = await person();
      for (let index = 0; index < 3; index++)
        await createOrganization(api, { adminIds: [busy._id] });
      const { user: owner, session: ownerSession } = await person();
      const organization = await createOrganization(api, {
        adminIds: [owner._id],
      });
      await patch(organizationUrl(organization.slug), ownerSession, {
        adminIds: [owner._id, busy._id],
      }).expect(400);
    });

    it('lets only staff change isUnlisted, slots and shortName; admins may change isOpen', async () => {
      const { user: owner, session: ownerSession } = await person();
      const organization = await createOrganization(api, {
        adminIds: [owner._id],
      });
      await patch(organizationUrl(organization.slug), ownerSession, {
        isUnlisted: true,
      }).expect(403);
      await patch(organizationUrl(organization.slug), ownerSession, {
        isOpen: false,
        name: 'Renamed',
      }).expect(200);
      const { session: staff } = await person({
        permissions: ['judge.edit_all_organization'],
      });
      await patch(organizationUrl(organization.slug), staff, {
        isUnlisted: true,
        slots: 2,
        shortName: 'short',
      }).expect(200);
      expect(
        await api.organizations.findById(organization._id).lean(),
      ).toMatchObject({
        name: 'Renamed',
        isOpen: false,
        isUnlisted: true,
        slots: 2,
        shortName: 'short',
      });
      const { session: outsider } = await person();
      await patch(organizationUrl(organization.slug), outsider, {
        name: 'Hijack',
      }).expect(403);
      await patch(organizationUrl('missing'), outsider, {
        name: 'Hijack',
      }).expect(404);
    });

    it('refuses null on every field but slots and leaves the row unchanged', async () => {
      const { user: owner, session } = await person();
      const organization = await createOrganization(api, {
        adminIds: [owner._id],
        about: 'kept',
      });
      const response = await patch(
        organizationUrl(organization.slug),
        session,
        {
          name: null,
          slug: null,
          about: null,
          isOpen: null,
        },
      ).expect(400);
      expect(
        Object.keys(
          (response.body as { error: { fields: object } }).error.fields,
        ).sort(),
      ).toEqual(['about', 'isOpen', 'name', 'slug']);
      expect(
        await api.organizations.findById(organization._id).lean(),
      ).toMatchObject({
        slug: organization.slug,
        name: organization.name,
        about: 'kept',
        isOpen: true,
      });
      const { session: staff } = await person({
        permissions: ['judge.edit_all_organization'],
      });
      await patch(organizationUrl(organization.slug), staff, {
        slots: null,
      }).expect(200);
    });

    it('renames a slug: taken in any case is 400, a case change of its own is 200', async () => {
      const { user: owner, session } = await person();
      await createOrganization(api, { slug: 'rename-beta' });
      const organization = await createOrganization(api, {
        adminIds: [owner._id],
        slug: 'rename-alpha',
      });
      const response = await patch(organizationUrl('rename-alpha'), session, {
        slug: 'RENAME-BETA',
      }).expect(400);
      expect(
        (response.body as { error: { fields: Record<string, string[]> } }).error
          .fields.slug,
      ).toBeDefined();
      const renamed = dataOf<OrganizationDetailResponse>(
        await patch(organizationUrl('rename-alpha'), session, {
          slug: 'Rename-Alpha',
        }).expect(200),
      );
      expect(renamed.slug).toBe('Rename-Alpha');
      expect(
        (await api.organizations.findById(organization._id).lean())!.slug,
      ).toBe('Rename-Alpha');
    });

    it('makes new admins members past the open-organization cap and keeps removed ones as members', async () => {
      const { user: owner, session: ownerSession } = await person();
      const { user: newcomer } = await person();
      for (let index = 0; index < 3; index++)
        await createOrganization(api, {}, [newcomer._id]);
      const organization = await createOrganization(api, {
        adminIds: [owner._id],
      });
      await patch(organizationUrl(organization.slug), ownerSession, {
        adminIds: [owner._id, newcomer._id],
      }).expect(200);
      expect(await membershipsOf(newcomer._id)).toContain(organization._id);
      await patch(organizationUrl(organization.slug), ownerSession, {
        adminIds: [owner._id],
      }).expect(200);
      expect(await membershipsOf(newcomer._id)).toContain(organization._id);
      await patch(organizationUrl(organization.slug), ownerSession, {
        adminIds: [],
      }).expect(400);
    });

    it('joins open organizations up to three, never a private one, never twice; private ones do not count', async () => {
      const { user, session } = await person();
      const [first, second, third, fourth] = [
        await createOrganization(api),
        await createOrganization(api),
        await createOrganization(api),
        await createOrganization(api),
      ];
      const closed = await createOrganization(api, { isOpen: false }, [
        user._id,
      ]);
      await post(organizationUrl(first.slug, '/join'), session).expect(204);
      await post(organizationUrl(first.slug, '/join'), session).expect(409);
      await post(organizationUrl(second.slug, '/join'), session).expect(204);
      await post(organizationUrl(third.slug, '/join'), session).expect(204);
      await post(organizationUrl(fourth.slug, '/join'), session).expect(409);
      expect(await membershipsOf(user._id)).toEqual([
        closed._id,
        first._id,
        second._id,
        third._id,
      ]);
      const { session: other } = await person();
      await post(organizationUrl(closed.slug, '/join'), other).expect(409);
      expect((await queuedFor()).sort()).toEqual(
        [first._id, second._id, third._id].sort(),
      );
    });

    it('refuses a direct join into a full organization', async () => {
      const { user: member } = await person();
      const full = await createOrganization(api, { slots: 1 }, [member._id]);
      const { user, session } = await person();
      const refused = await post(organizationUrl(full.slug, '/join'), session);
      expect(refused.status).toBe(409);
      expect(JSON.stringify(refused.body)).toContain('organization_full');
      expect(await membershipsOf(user._id)).toEqual([]);
      await api.organizations.updateOne({ _id: full._id }, { slots: 2 });
      await post(organizationUrl(full.slug, '/join'), session).expect(204);
    });

    it('lets only one of five parallel joins through at the open-organization cap', async () => {
      const { user, session } = await person();
      await createOrganization(api, {}, [user._id]);
      await createOrganization(api, {}, [user._id]);
      const targets = await Promise.all(
        Array.from({ length: 5 }, () => createOrganization(api)),
      );
      const statuses = (
        await Promise.all(
          targets.map((target) =>
            post(organizationUrl(target.slug, '/join'), session),
          ),
        )
      ).map((response) => response.status);
      expect(statuses.filter((status) => status === 204)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(4);
      expect(await membershipsOf(user._id)).toHaveLength(3);
    });

    it('leaves and kicks members, never admins; only administrators kick', async () => {
      const { user: owner, session: ownerSession } = await person();
      const { user: member, session: memberSession } = await person();
      const { user: other } = await person();
      const organization = await createOrganization(
        api,
        { adminIds: [owner._id] },
        [member._id, other._id],
      );
      await post(
        organizationUrl(organization.slug, '/leave'),
        ownerSession,
      ).expect(409);
      await post(organizationUrl(organization.slug, '/kick'), memberSession, {
        userId: other._id,
      }).expect(403);
      await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
        userId: owner._id,
      }).expect(409);
      await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
        userId: other._id,
      }).expect(204);
      await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
        userId: other._id,
      }).expect(409);
      await post(
        organizationUrl(organization.slug, '/leave'),
        memberSession,
      ).expect(204);
      await post(
        organizationUrl(organization.slug, '/leave'),
        memberSession,
      ).expect(409);
      expect(await membershipsOf(member._id)).toEqual([]);
      const { session: staff } = await person({
        permissions: ['judge.edit_all_organization'],
      });
      const { user: third } = await person();
      await api.users.updateOne(
        { _id: third._id },
        { $push: { organizations: organization._id } },
      );
      await post(organizationUrl(organization.slug, '/kick'), staff, {
        userId: third._id,
      }).expect(204);
      // Leave, kick and kick collapse into the one waiting job.
      expect(await queuedFor()).toEqual([organization._id]);
      // The worker clears the flag when it starts, so a change meanwhile queues the next recompute.
      await clearOrganizationPointsPending(
        api.app.get<Redis>(REDIS),
        organization._id,
      );
      const { user: fourth } = await person();
      await api.users.updateOne(
        { _id: fourth._id },
        { $push: { organizations: organization._id } },
      );
      await post(organizationUrl(organization.slug, '/kick'), staff, {
        userId: fourth._id,
      }).expect(204);
      expect(await queuedFor()).toEqual([organization._id, organization._id]);
    });

    it('gives exactly one of eight parallel creates the last admin role', async () => {
      const { user, session } = await person({
        permissions: ['judge.add_organization'],
      });
      for (let index = 0; index < 2; index++)
        await createOrganization(api, { adminIds: [user._id] });
      const statuses = (
        await Promise.all(
          Array.from({ length: 8 }, (_unused, index) => `parallel${index}`).map(
            (slug) =>
              post('/api/internal/organizations', session, {
                name: slug,
                slug,
              }),
          ),
        )
      ).map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(
        statuses.filter((status) => status === 409 || status === 403),
      ).toHaveLength(7);
      expect(
        await api.organizations.countDocuments({ adminIds: user._id }),
      ).toBe(3);
    });

    it('queues one recompute job per distinct organization', async () => {
      const points = api.app.get(OrganizationPointsService);
      const addBulk = jest.spyOn(BullQueue.prototype, 'addBulk');
      try {
        await points.refresh(['org-a', 'org-b', 'org-a']);
        await points.refresh([]);
        const queued = addBulk.mock.calls
          .flatMap(([jobs]) => jobs)
          .filter((job) => job.name === ORGANIZATION_POINTS_JOB)
          .map((job) => (job.data as OrganizationPointsJob).organizationId);
        expect(queued).toEqual(['org-a', 'org-b']);
      } finally {
        addBulk.mockRestore();
      }
    });
  });
}
