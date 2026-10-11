import type { User } from '@libs/database';
import type {
  OrganizationDetailResponse,
  OrganizationListItemResponse,
} from '../src/modules/organizations/core/dto/organization.response';
import type { OrganizationRevisionResponse } from '../src/modules/organizations/editing/dto/organization-revision.response';
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
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';

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
    const get = (url: string, session: TestSession) =>
      authed(api.http().get(url), session);
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
    const issueCode =
      (code: string) =>
      ({ body }: { body: { error: { issues?: { code: string }[] } } }) =>
        expect(body.error.issues?.map((issue) => issue.code)).toContain(code);

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

    it('caps admin roles at three unless the acting user has spam_organization', async () => {
      const { user, session } = await person({
        permissions: ['judge.add_organization'],
      });
      for (let index = 0; index < 3; index++)
        await createOrganization(api, { adminIds: [user._id] });
      await post('/api/internal/organizations', session, {
        name: 'Fourth',
        slug: 'fourth',
      })
        .expect(403)
        .expect(issueCode('admin_cap'));
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
      })
        .expect(400)
        .expect(issueCode('admin_cap'));
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

    it('records edits, with admins by username, and kicks in a history only administrators read', async () => {
      const { user: owner, session: ownerSession } = await person();
      const { user: helper } = await person();
      const { user: member } = await person();
      const { session: outsider } = await person();
      const organization = await createOrganization(
        api,
        { adminIds: [owner._id] },
        [member._id],
      );
      const url = organizationUrl(organization.slug);
      await patch(url, ownerSession, {
        name: 'Renamed',
        adminIds: [owner._id, helper._id],
      }).expect(200);
      await patch(url, ownerSession, { name: 'Renamed' }).expect(200);
      await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
        userId: member._id,
      }).expect(204);
      await get(`${url}/revisions`, outsider).expect(403);
      const history = dataOf<OrganizationRevisionResponse[]>(
        await get(`${url}/revisions`, ownerSession).expect(200),
      );
      expect(history.map((row) => row.action)).toEqual(['kick', 'edit']);
      expect(history[0]).toMatchObject({
        editor: { username: owner.username },
        changes: { member: { before: member.username, after: null } },
      });
      expect(history[1].changes).toEqual({
        name: { before: organization.name, after: 'Renamed' },
        admins: {
          before: [owner.username],
          after: [owner.username, helper.username].sort(),
        },
      });
    });

    it('lets only edit_all_organization queue a points recalculation', async () => {
      const { user: owner, session: ownerSession } = await person();
      const { session: staff } = await person({
        permissions: ['judge.edit_all_organization'],
      });
      const organization = await createOrganization(api, {
        adminIds: [owner._id],
      });
      const url = organizationUrl(organization.slug, '/recalculate');
      await post(url, ownerSession).expect(403);
      await post(organizationUrl('missing', '/recalculate'), staff).expect(404);
      await post(url, staff).expect(204);
      expect(await queuedFor()).toEqual([organization._id]);
    });

    it('previews about text, escaped like a save, only for creators and administrators', async () => {
      const { user: owner, session: ownerSession } = await person();
      const { session: outsider } = await person();
      await createOrganization(api, { adminIds: [owner._id] });
      const url = '/api/internal/organizations/render-preview';
      await post(url, outsider, { markdown: 'hi' }).expect(403);
      const { html } = dataOf<{ html: string }>(
        await post(url, ownerSession, { markdown: '<b>hi</b>' }).expect(200),
      );
      expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    });

    it('searches members by username and ranks only the matches', async () => {
      const { user: best } = await person({ performancePoints: 30 });
      const { user: middle } = await person({ performancePoints: 20 });
      const { user: worst } = await person({ performancePoints: 10 });
      await api.users.updateMany({ _id: { $in: [best._id, worst._id] } }, [
        { $set: { username: { $concat: ['findme_', '$username'] } } },
      ]);
      const organization = await createOrganization(api, {}, [
        best._id,
        middle._id,
        worst._id,
      ]);
      const rows = dataOf<{ id: string; rank: number }[]>(
        await api
          .http()
          .get(organizationUrl(organization.slug, '/members?search=FINDME'))
          .expect(200),
      );
      expect(rows.map(({ id, rank }) => [id, rank])).toEqual([
        [best._id, 1],
        [worst._id, 2],
      ]);
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
  });
}
