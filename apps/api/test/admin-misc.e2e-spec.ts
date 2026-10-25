import { CONTEST_CHEATING_BAN_REASON } from '../src/modules/contests/participation/contest-participation.service';

import { authed, createUserWith, loginAs } from './problem-fixtures';

import { createOrganization } from './organization-fixtures';

import {
  setupApiTest,
  errorCode,
  issueCodes,
  createUser,
  sessionCookie,
  TEST_ENV,
} from './setup';

import type { ApiTest } from './setup';

import { profileQueries } from '@libs/database/testing';

import type {
  GroupResponse,
  UserAccessResponse,
} from '../src/modules/users/access/dto/access.response';

import type { StaffUserResponse } from '../src/modules/users/admin/dto/staff-user.response';

import type { TestSession } from './problem-fixtures';

import type { AuditFeedResponse } from '../src/modules/audit/dto/audit-entry.response';

import {
  dataOf,
  bridgeCommands,
  clearBridgeCommands,
} from './submission-fixtures';

import { sha256, generateApiToken, PERMISSION_CATALOG } from '@libs/auth';

import { getModelToken } from '@nestjs/mongoose';

import { IntegrationClient, SettingRevision, newId } from '@libs/database';

import type { Model } from 'mongoose';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from user-ban.e2e-spec.ts
{
  describe('ban and unban', () => {
    beforeAll(() => api.reset());
    beforeAll(async () => {});

    it('signs a banned user out at once, unlists them, and unban restores them', async () => {
      const moderator = await loginAs(
        api,
        (
          await createUserWith(api, 'moderator', {
            permissions: ['judge.ban_user'],
          })
        )._id,
      );
      const target = await createUserWith(api, 'target', {
        displayRank: 'user',
      });
      const targetSession = await loginAs(api, target._id);
      const { token, hash } = generateApiToken(
        target._id,
        TEST_ENV.TOKEN_SECRET,
      );
      await api.users.updateOne({ _id: target._id }, { apiTokenHash: hash });
      await authed(
        api.http().get('/api/internal/profile'),
        targetSession,
      ).expect(200);
      await authed(api.http().post('/api/internal/users/target/ban'), moderator)
        .send({ reason: 'spam' })
        .expect(204);
      await authed(
        api.http().get('/api/internal/profile'),
        targetSession,
      ).expect(401);
      expect(await api.users.findById(target._id).lean()).toMatchObject({
        banReason: 'spam',
        displayRank: 'banned',
        isUnlisted: true,
        isActive: false,
        apiTokenHash: null,
      });
      await authed(api.http().post('/api/internal/users/target/ban'), moderator)
        .send({ reason: 'again' })
        .expect(409);
      const login = () =>
        api
          .http()
          .post('/api/internal/auth/login')
          .send({ username: 'target', password: 'correct horse battery' });
      expect((await login()).status).toBe(403);
      await authed(
        api.http().post('/api/internal/users/target/unban'),
        moderator,
      ).expect(204);
      expect(await api.users.findById(target._id).lean()).toMatchObject({
        banReason: null,
        displayRank: 'user',
        isUnlisted: false,
        isActive: true,
      });
      expect((await login()).status).toBe(200);
      await api
        .http()
        .get('/api/internal/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await authed(
        api.http().post('/api/internal/users/target/unban'),
        moderator,
      ).expect(409);
    });

    it('unban restores the active flag from before the ban, and both are audited', async () => {
      const moderator = await loginAs(
        api,
        (
          await createUserWith(api, 'moderator3', {
            permissions: ['judge.ban_user'],
          })
        )._id,
      );
      const pending = await createUserWith(api, 'pending', { isActive: false });
      await authed(
        api.http().post('/api/internal/users/pending/ban'),
        moderator,
      )
        .send({ reason: 'spam' })
        .expect(204);
      await authed(
        api.http().post('/api/internal/users/pending/unban'),
        moderator,
      ).expect(204);
      expect(await api.users.findById(pending._id).lean()).toMatchObject({
        banReason: null,
        isActive: false,
      });
      const audit = await api.revisions
        .find({ entity: 'user', entityId: pending._id })
        .sort({ _id: 1 })
        .lean();
      expect(audit.map((row) => [row.action, row.comment])).toEqual([
        ['ban', 'spam'],
        ['unban', 'spam'],
      ]);
    });

    it('never bans yourself, a superuser, or without ban_user', async () => {
      const moderator = await createUserWith(api, 'moderator2', {
        permissions: ['judge.ban_user'],
      });
      const session = await loginAs(api, moderator._id);
      await createUserWith(api, 'root', { isSuperuser: true });
      await authed(
        api.http().post('/api/internal/users/moderator2/ban'),
        session,
      )
        .send({ reason: 'x' })
        .expect(403);
      await authed(api.http().post('/api/internal/users/root/ban'), session)
        .send({ reason: 'x' })
        .expect(403);
      await authed(api.http().post('/api/internal/users/nobody/ban'), session)
        .send({ reason: CONTEST_CHEATING_BAN_REASON })
        .expect(400);
      await authed(api.http().post('/api/internal/users/nobody/ban'), session)
        .send({ reason: 'x' })
        .expect(404);
      await authed(api.http().post('/api/internal/users/root/ban'), session)
        .send({ reason: '' })
        .expect(400);
      const plain = await loginAs(
        api,
        (await createUserWith(api, 'plain'))._id,
      );
      await authed(api.http().post('/api/internal/users/moderator2/ban'), plain)
        .send({ reason: 'x' })
        .expect(403);
    });

    it('resets two-factor for staff only, from a browser session, never a superuser, signs the user out and leaves an audit row', async () => {
      const recovery = await createUserWith(api, 'recovery', {
        permissions: ['judge.ban_user'],
      });
      const staff = await loginAs(api, recovery._id);
      const locked = await createUserWith(api, 'locked', {
        isTotpEnabled: true,
        totpKey: 'secret',
        scratchCodes: 'codes',
        isWebauthnEnabled: true,
        webauthnCredentials: [
          {
            _id: '01900000-0000-7000-8000-0000000000bb',
            name: 'key',
            credId: 'AA',
            publicKey: 'AA',
            counter: 0,
          },
        ],
      });
      const lockedSession = await loginAs(api, locked._id);
      const reset = (name: string, session = staff) =>
        authed(
          api.http().post(`/api/internal/users/${name}/reset-two-factor`),
          session,
        );
      await reset(
        'locked',
        await loginAs(api, (await createUserWith(api, 'plain2'))._id),
      ).expect(403);
      const staffToken = generateApiToken(recovery._id, TEST_ENV.TOKEN_SECRET);
      await api.users.updateOne(
        { _id: recovery._id },
        { apiTokenHash: staffToken.hash },
      );
      await api
        .http()
        .post('/api/internal/users/locked/reset-two-factor')
        .set('Authorization', `Bearer ${staffToken.token}`)
        .expect(403);
      await reset('locked').expect(204);
      expect(await api.users.findById(locked._id).lean()).toMatchObject({
        isTotpEnabled: false,
        totpKey: null,
        scratchCodes: null,
        isWebauthnEnabled: false,
        webauthnCredentials: [],
      });
      await authed(
        api.http().get('/api/internal/profile'),
        lockedSession,
      ).expect(401);
      expect(
        await api.revisions.countDocuments({
          entity: 'user',
          entityId: locked._id,
          action: 'reset_two_factor',
        }),
      ).toBe(1);
      await createUserWith(api, 'boss', { isSuperuser: true });
      await reset('boss').expect(403);
    });
  });
}

// from user-admin.e2e-spec.ts
{
  const BASE = '/api/internal/admin/users';
  const STAFF_KEYS = [
    'banReason',
    'dateJoined',
    'displayName',
    'displayRank',
    'id',
    'isActive',
    'isStaff',
    'isSuperuser',
    'lastAccess',
    'rating',
    'username',
  ].sort();

  describe('staff user list', () => {
    beforeAll(() => api.reset());
    let moderator: TestSession;
    const list = async (query = '', session = moderator) => {
      const response = await authed(
        api.http().get(`${BASE}${query}`),
        session,
      ).expect(200);
      return {
        items: dataOf<StaffUserResponse[]>(response),
        meta: (response.body as { meta: { total: number } }).meta,
      };
    };
    const names = async (query = '') =>
      (await list(query)).items.map((item) => item.username);

    beforeAll(async () => {
      moderator = await loginAs(
        api,
        (
          await createUserWith(api, 'moderator', {
            permissions: ['judge.ban_user'],
          })
        )._id,
      );
      await createUserWith(api, 'alice1', {});
      await createUserWith(api, 'alice2', {});
      await createUserWith(api, 'bob', { rating: 1777 });
      await createUserWith(api, 'mallory', {
        banReason: 'spam',
        displayRank: 'banned',
        isActive: false,
      });
    });

    it('matches usernames by case-insensitive prefix, in username order', async () => {
      expect(await names('?search=ali')).toEqual(['alice1', 'alice2']);
      expect(await names('?search=ALI')).toEqual(['alice1', 'alice2']);
      expect(await names('?search=lice')).toEqual([]);
    });

    it('treats the search as literal text, never as a pattern', async () => {
      expect(await names('?search=.*')).toEqual([]);
      expect(await names('?search=a(')).toEqual([]);
      expect(await names('?search=%5E')).toEqual([]);
    });

    it('never returns an e-mail, a password hash or a second-factor secret', async () => {
      const { items } = await list('?search=mal');
      expect(Object.keys(items[0]).sort()).toEqual(STAFF_KEYS);
      expect(JSON.stringify(items)).not.toMatch(/email|password|totp|scratch/i);
    });

    it('refuses users without judge.ban_user and anonymous callers', async () => {
      const plain = await loginAs(
        api,
        (await createUserWith(api, 'plain', {}))._id,
      );
      await authed(api.http().get(BASE), plain).expect(403);
      await api.http().get(BASE).expect(401);
    });

    /** Counts are `COUNT_SCAN` on the same key; finds are `IXSCAN`. */
    const onIndex = (key: string) =>
      new RegExp(`(IXSCAN|COUNT_SCAN) \\{ ${key}: 1 \\}`);

    it('serves each filter and order from its index', async () => {
      // The auth guard reads the session's user by _id (an EXPRESS plan) on every request; the list's own reads are not express.
      const cases: Array<{
        query: string;
        find: RegExp;
        mayUseSort: boolean;
        count: RegExp | null;
      }> = [
        {
          query: '?search=ali',
          find: /IXSCAN \{ username: 1 \}/,
          mayUseSort: false,
          count: onIndex('username'),
        },
        {
          query: '?sort=-lastAccess',
          find: /IXSCAN \{ lastAccess: 1, _id: 1 \}/,
          mayUseSort: false,
          count: null,
        },
        {
          query: '?sort=lastAccess',
          find: /IXSCAN \{ lastAccess: 1, _id: 1 \}/,
          mayUseSort: false,
          count: null,
        },
        {
          query: '?search=ALI&banned=true',
          // The planner may pick the small banned index; its sort then covers only banned users.
          find: /IXSCAN \{ (username|banReason): 1 \}/,
          mayUseSort: true,
          count: onIndex('(username|banReason)'),
        },
        {
          query: '?banned=true',
          find: /IXSCAN \{ banReason: 1 \}/,
          mayUseSort: true,
          count: onIndex('banReason'),
        },
        {
          // Not banned has no index of its own: the find walks _id, and the count is the whole collection's, as the unfiltered list's is.
          query: '?banned=false',
          find: /IXSCAN \{ _id: 1 \}/,
          mayUseSort: false,
          count: null,
        },
      ];
      for (const { query, find, mayUseSort, count } of cases) {
        const operations = await profileQueries(api.db, () =>
          authed(api.http().get(`${BASE}${query}`), moderator).expect(200),
        );
        const reads = operations.filter(
          ({ collection, planSummary }) =>
            collection === 'users' && !planSummary.startsWith('EXPRESS_'),
        );
        const finds = reads.filter(({ operation }) => operation === 'query');
        expect(finds.length).toBe(1);
        expect(`${query} ${finds[0].planSummary}`).toMatch(find);
        if (!mayUseSort) expect(finds[0].hasSortStage).toBe(false);
        if (count)
          for (const read of reads.filter(
            ({ operation }) => operation !== 'query',
          ))
            expect(`${query} ${read.planSummary}`).toMatch(count);
      }
    });

    it('sorts by last access either way, with never-seen users oldest, over a search', async () => {
      await createUserWith(api, 'seen_old', {
        lastAccess: new Date('2025-01-01T00:00:00Z'),
      });
      await createUserWith(api, 'seen_new', {
        lastAccess: new Date('2026-06-01T00:00:00Z'),
      });
      await createUserWith(api, 'seen_never', { lastAccess: null });
      expect(await names('?search=seen&sort=lastAccess')).toEqual([
        'seen_never',
        'seen_old',
        'seen_new',
      ]);
      expect(await names('?search=seen&sort=-lastAccess')).toEqual([
        'seen_new',
        'seen_old',
        'seen_never',
      ]);
      await authed(api.http().get(`${BASE}?sort=username`), moderator).expect(
        400,
      );
    });
  });
}

// username suggestions
{
  const SUGGEST = (prefix: string) =>
    `/api/internal/user-suggestions?prefix=${encodeURIComponent(prefix)}`;

  describe('username suggestions', () => {
    beforeAll(() => api.reset());
    let viewer: TestSession;
    const suggest = async (prefix: string, session = viewer) =>
      dataOf<Array<{ id: string; username: string }>>(
        await authed(api.http().get(SUGGEST(prefix)), session).expect(200),
      );

    beforeAll(async () => {
      viewer = await loginAs(api, (await createUserWith(api, 'viewer'))._id);
      for (const name of ['Zed12', 'zed03', 'zed01', 'zedbanned', 'azed'])
        await createUserWith(api, name, {});
      await api.users.updateOne(
        { username: 'zedbanned' },
        { banReason: 'spam', isActive: false, isUnlisted: true },
      );
      for (let index = 0; index < 12; index += 1)
        await createUserWith(api, `many${String(index).padStart(2, '0')}`);
    });

    it('offers users by case-insensitive prefix in username order, banned ones too, with only id and username', async () => {
      const found = await suggest('ZED');
      expect(found.map((user) => user.username)).toEqual([
        'zed01',
        'zed03',
        'Zed12',
        'zedbanned',
      ]);
      expect(Object.keys(found[0]).sort()).toEqual(['id', 'username']);
    });

    it('offers at most ten users', async () => {
      expect(await suggest('many')).toHaveLength(10);
    });

    it('refuses anonymous callers and a prefix that is not a username', async () => {
      await api.http().get(SUGGEST('zed')).expect(401);
      await authed(api.http().get(SUGGEST('a.*')), viewer).expect(400);
      await authed(
        api.http().get('/api/internal/user-suggestions'),
        viewer,
      ).expect(400);
    });

    it('limits each caller to 60 requests a minute, without slowing anyone else', async () => {
      const busy = await loginAs(api, (await createUserWith(api, 'busy'))._id);
      for (let index = 0; index < 60; index += 1) await suggest('zed', busy);
      const refused = await authed(api.http().get(SUGGEST('zed')), busy)
        .expect(429)
        .expect(errorCode('rate_limited'));
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      await suggest('zed');
    });
  });
}

// from judges.e2e-spec.ts
{
  const JUDGES = '/api/internal/judges';
  describe('/api/internal/judges', () => {
    beforeAll(() => api.reset());
    let admin: TestSession;
    let member: TestSession;
    const create = async (name: string) =>
      dataOf<{ judge: { name: string }; authKey: string }>(
        await authed(api.http().post(JUDGES), admin).send({ name }).expect(201),
      );
    const storedHash = async (name: string) =>
      (await api.judges.findOne({ name }).lean())?.authKeyHash;

    beforeAll(async () => {
      admin = await loginAs(
        api,
        (
          await createUserWith(api, 'admin', {
            permissions: ['judge.change_judge'],
          })
        )._id,
      );
      member = await loginAs(api, (await createUserWith(api, 'member'))._id);
    });
    beforeEach(() => clearBridgeCommands(api));

    it('every judge route is for judge.change_judge holders only', async () => {
      await create('judge-guarded');
      const routes = [
        api.http().get(JUDGES),
        api.http().post(JUDGES).send({ name: 'judge-denied' }),
        api.http().patch(`${JUDGES}/judge-guarded`).send({ isBlocked: true }),
        api.http().post(`${JUDGES}/judge-guarded/key`),
        api.http().post(`${JUDGES}/judge-guarded/disconnect`).send({}),
        api.http().delete(`${JUDGES}/judge-guarded`),
        api.http().post(`${JUDGES}/judge-guarded/rename`).send({ name: 'x' }),
        api.http().get(`${JUDGES}/queue`),
      ];
      await api.http().get(JUDGES).expect(401);
      for (const route of routes)
        await authed(route, member).expect(403).expect(errorCode('forbidden'));
      expect(await storedHash('judge-denied')).toBeUndefined();
      expect(await api.judges.findOne({ name: 'judge-guarded' })).toMatchObject(
        {
          isBlocked: false,
        },
      );
      expect(await bridgeCommands(api)).toEqual([]);
    });

    it('creates a judge whose key is shown once and stored only as its hash', async () => {
      const { judge, authKey } = dataOf<{ judge: object; authKey: string }>(
        await authed(api.http().post(JUDGES), admin)
          .send({ name: 'judge-a', description: 'rack 1' })
          .expect(201),
      );
      expect(judge).toMatchObject({
        name: 'judge-a',
        description: 'rack 1',
        online: false,
        isBlocked: false,
        isDisabled: false,
        runtimes: [],
        slots: 0,
        busy: 0,
        build: '',
        features: [],
      });
      expect(authKey.length).toBeGreaterThanOrEqual(32);
      expect(await storedHash('judge-a')).toBe(sha256(authKey));
      const listed = JSON.stringify(
        (await authed(api.http().get(JUDGES), admin).expect(200)).body,
      );
      expect(listed).not.toContain(authKey);
      expect(listed).not.toContain((await storedHash('judge-a'))!);
    });

    it('rotates the key, replacing the stored hash, and asks the bridge to drop the judge', async () => {
      const { authKey: oldKey } = await create('judge-rot');
      const { authKey } = dataOf<{ authKey: string }>(
        await authed(api.http().post(`${JUDGES}/judge-rot/key`), admin).expect(
          200,
        ),
      );
      expect(authKey).not.toBe(oldKey);
      expect(await storedHash('judge-rot')).toBe(sha256(authKey));
      expect(await bridgeCommands(api)).toEqual([
        { type: 'disconnect-judge', judgeName: 'judge-rot', force: true },
      ]);
    });

    it('deletes an offline judge and refuses an online one with 409', async () => {
      await create('judge-old');
      await create('judge-live');
      await api.judges.updateOne({ name: 'judge-live' }, { online: true });
      await authed(api.http().delete(`${JUDGES}/judge-live`), admin)
        .expect(409)
        .expect(errorCode('conflict'));
      await authed(api.http().delete(`${JUDGES}/judge-old`), admin).expect(204);
      await authed(api.http().delete(`${JUDGES}/judge-old`), admin)
        .expect(404)
        .expect(errorCode('not_found'));
      expect(await api.judges.findOne({ name: 'judge-live' })).not.toBeNull();
    });

    it('renames an offline judge with nothing in flight, moving queued pins to the new name', async () => {
      const rename = (from: string, name: string) =>
        authed(api.http().post(`${JUDGES}/${from}/rename`), admin).send({
          name,
        });
      await create('judge-ren');
      await create('judge-taken');
      const row = (status: string, pins: Record<string, string>) => ({
        user: newId(),
        problem: newId(),
        language: newId(),
        status,
        ...pins,
      });
      const [queued, running] = await api.submissions.create([
        row('QU', { pinnedJudge: 'judge-ren' }),
        row('G', { judgedOn: 'judge-ren' }),
      ]);
      // a run handed out before the judge dropped may still resume under the old name
      await rename('judge-ren', 'judge-new')
        .expect(409)
        .expect(issueCodes(['judge_busy']));
      await api.submissions.updateOne({ _id: running._id }, { status: 'D' });
      await rename('judge-ren', 'judge-taken')
        .expect(409)
        .expect(issueCodes(['name_taken']));
      await api.judges.updateOne({ name: 'judge-ren' }, { online: true });
      await rename('judge-ren', 'judge-new')
        .expect(409)
        .expect(issueCodes(['judge_online']));
      await api.judges.updateOne({ name: 'judge-ren' }, { online: false });
      const renamed = dataOf<{ name: string }>(
        await rename('judge-ren', 'judge-new').expect(200),
      );
      expect(renamed.name).toBe('judge-new');
      expect(await api.judges.exists({ name: 'judge-ren' })).toBeNull();
      expect(
        (await api.submissions.findById(queued._id).lean())?.pinnedJudge,
      ).toBe('judge-new');
      // the finished run keeps the name it was judged on
      expect(
        (await api.submissions.findById(running._id).lean())?.judgedOn,
      ).toBe('judge-ren');
    });

    it('stores a block reason with the block and clears it on unblock', async () => {
      await create('judge-blk');
      const patch = (body: object) =>
        authed(api.http().patch(`${JUDGES}/judge-blk`), admin).send(body);
      expect(
        dataOf<{ blockReason: string }>(
          await patch({ isBlocked: true, blockReason: 'leaked key' }).expect(
            200,
          ),
        ).blockReason,
      ).toBe('leaked key');
      expect(
        dataOf<{ blockReason: string; isBlocked: boolean }>(
          await patch({ isBlocked: false }).expect(200),
        ),
      ).toMatchObject({ isBlocked: false, blockReason: '' });
    });
  });
}

// from integration-clients.e2e-spec.ts
{
  interface Client {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    allowedCidrs: string[];
    actsAs: { id: string; username: string };
    revokedAt: string | null;
    expiresAt: string | null;
    key?: string;
  }

  const URL = '/api/internal/integration-clients';

  describe('integration client administration', () => {
    beforeAll(() => api.reset());
    let clients: Model<IntegrationClient>;
    let adminId: string;
    let admin: TestSession;
    let counter = 0;
    const body = (extra: Record<string, unknown> = {}) => ({
      name: `bridge ${(counter += 1)}`,
      scopes: ['contests:write', 'contests:read'],
      allowedCidrs: ['10.0.0.0/8'],
      actsAs: 'syncauthor',
      ...extra,
    });
    const post = (payload: object, session = admin) =>
      authed(api.http().post(URL), session).send(payload);

    beforeAll(async () => {
      clients = api.app.get(getModelToken(IntegrationClient.name));
      adminId = (
        await createUserWith(api, 'intadmin', {
          permissions: ['judge.manage_integration'],
        })
      )._id;
      admin = await loginAs(api, adminId);
      await createUserWith(api, 'syncauthor', {
        permissions: ['judge.add_contest', 'judge.create_private_contest'],
      });
      await createUserWith(api, 'weakauthor', {
        permissions: ['judge.add_contest'],
      });
      await createUserWith(api, 'rootauthor', {
        permissions: ['judge.add_contest', 'judge.create_private_contest'],
        isSuperuser: true,
      });
      await createUserWith(api, 'sleeper', {
        permissions: ['judge.add_contest', 'judge.create_private_contest'],
        isActive: false,
      });
    });

    it('creates a client, shows the key once and stores only its hash', async () => {
      const created = dataOf<Client>(await post(body()).expect(201));
      expect(created.key).toMatch(/^qhi_[A-Za-z0-9_-]{43}$/);
      expect(created.keyPrefix).toBe(created.key!.slice(0, 8));
      expect(created.actsAs.username).toBe('syncauthor');
      expect(created.expiresAt).toBeNull();
      const stored = await clients.findById(created.id).lean();
      expect(stored?.keyHash).toBe(sha256(created.key!));
      expect(JSON.stringify(stored)).not.toContain(created.key!);
      const listed = await authed(api.http().get(URL), admin).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(created.key!);
      const row = dataOf<Client[]>(listed).find(
        (client) => client.id === created.id,
      );
      expect(row).toMatchObject({
        name: created.name,
        scopes: ['contests:write', 'contests:read'],
      });
      expect(row?.key).toBeUndefined();
    });

    it.each([
      ['an unknown acting user', { actsAs: 'nobody' }],
      [
        'an acting user without create_private_contest',
        { actsAs: 'weakauthor' },
      ],
      ['an inactive acting user', { actsAs: 'sleeper' }],
      ['a superuser acting user', { actsAs: 'rootauthor' }],
      ['no CIDR', { allowedCidrs: [] }],
      ['a bad CIDR', { allowedCidrs: ['10.0.0.0'] }],
      ['an out-of-range prefix', { allowedCidrs: ['10.0.0.0/33'] }],
      ['no scope', { scopes: [] }],
      ['an unknown scope', { scopes: ['users:write'] }],
      ['an empty name', { name: '' }],
      ['an extra field', { isAdmin: true }],
      ['an expiry in the past', { expiresAt: '2020-01-01T00:00:00Z' }],
      ['a malformed expiry', { expiresAt: 'tomorrow' }],
    ])('refuses %s with 400 and creates nothing', async (_name, extra) => {
      const before = await clients.countDocuments({});
      await post(body(extra)).expect(400);
      expect(await clients.countDocuments({})).toBe(before);
    });

    it('is for holders of judge.manage_integration only', async () => {
      const plain = await loginAs(
        api,
        (await createUserWith(api, 'intplain'))._id,
      );
      await post(body(), plain).expect(403).expect(errorCode('forbidden'));
      await authed(api.http().get(URL), plain).expect(403);
      await api.http().post(URL).send(body()).expect(401);
    });

    it('refuses a user API token and an impersonated session: credentials are minted from a real browser session', async () => {
      const { token, hash } = generateApiToken(adminId, TEST_ENV.TOKEN_SECRET);
      await api.users.updateOne({ _id: adminId }, { apiTokenHash: hash });
      for (const request of [
        api.http().post(URL).send(body()),
        api.http().get(URL),
        api.http().delete(`${URL}/${adminId}`),
      ])
        await request
          .set('Authorization', `Bearer ${token}`)
          .expect(403)
          .expect(errorCode('forbidden'));
      const root = await createUser(api.users, {
        username: 'introot',
        email: 'introot@example.com',
        isSuperuser: true,
      });
      const { id, session } = await api.sessions.create({
        userId: adminId,
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: root._id,
      });
      await api
        .http()
        .post(URL)
        .set('Cookie', sessionCookie(id))
        .set('X-CSRF-Token', session.csrf)
        .send(body())
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('revokes a client, idempotently, and an unknown id is 404', async () => {
      const created = dataOf<Client>(await post(body()).expect(201));
      await authed(api.http().delete(`${URL}/${created.id}`), admin).expect(
        204,
      );
      const revoked = await clients.findById(created.id).lean();
      expect(revoked?.revokedAt).toBeInstanceOf(Date);
      await authed(api.http().delete(`${URL}/${created.id}`), admin).expect(
        204,
      );
      expect((await clients.findById(created.id).lean())?.revokedAt).toEqual(
        revoked?.revokedAt,
      );
      await authed(
        api.http().delete(`${URL}/0190a000-0000-7000-8000-000000000999`),
        admin,
      ).expect(404);
      await authed(api.http().delete(`${URL}/not-an-id`), admin).expect(404);
      const listed = dataOf<Client[]>(
        await authed(api.http().get(URL), admin).expect(200),
      );
      expect(
        listed.find((client) => client.id === created.id)?.revokedAt,
      ).not.toBeNull();
    });
  });
}

// staff user editing
{
  const USER = (name: string) => `/api/internal/admin/users/${name}`;
  const OLD = 'correct horse battery';

  describe('staff user editing', () => {
    beforeAll(() => api.reset());
    let editor: TestSession;
    let admin: TestSession;
    const setPassword = (
      name: string,
      body: Record<string, string>,
      session = admin,
    ) => authed(api.http().post(`${USER(name)}/password`), session).send(body);

    beforeAll(async () => {
      editor = await loginAs(
        api,
        (
          await createUserWith(api, 'editor', {
            permissions: ['judge.change_profile'],
          })
        )._id,
      );
      admin = await loginAs(
        api,
        (
          await createUserWith(api, 'admin', {
            permissions: ['judge.change_profile', 'auth.change_user'],
          })
        )._id,
      );
      await createUserWith(api, 'root', { isSuperuser: true });
    });

    it('needs change_profile to read, auth.change_user for credentials and e-mail, and a superuser to touch a superuser', async () => {
      await createUserWith(api, 'carol');
      const plain = await loginAs(
        api,
        (await createUserWith(api, 'plain'))._id,
      );
      await authed(api.http().get(`${USER('carol')}/profile`), plain).expect(
        403,
      );
      await authed(api.http().get(`${USER('carol')}/profile`), editor).expect(
        200,
      );
      await authed(api.http().patch(`${USER('carol')}/profile`), editor)
        .send({ email: 'new@example.com' })
        .expect(403)
        .expect(issueCodes(['email_not_editable']));
      await setPassword(
        'carol',
        { currentPassword: OLD, newPassword: 'fresh passphrase 1' },
        editor,
      ).expect(403);
      await authed(
        api.http().post(`${USER('carol')}/password-reset`),
        editor,
      ).expect(403);
      await authed(api.http().get(`${USER('root')}/profile`), admin).expect(
        403,
      );
      await authed(api.http().patch(`${USER('root')}/profile`), admin)
        .send({ displayName: 'x' })
        .expect(403);
      await setPassword('admin', {
        currentPassword: OLD,
        newPassword: 'fresh passphrase 1',
      }).expect(403);
      const superuser = await loginAs(
        api,
        (await createUserWith(api, 'root2', { isSuperuser: true }))._id,
      );
      await authed(api.http().patch(`${USER('root')}/profile`), superuser)
        .send({ displayName: 'Root' })
        .expect(200);
    });

    it("requires the admin's own password, then revokes the user's sessions and API token and audits without the secret", async () => {
      const target = await createUserWith(api, 'dave', {
        passwordSetBeforeVerification: true,
      });
      const targetSession = await loginAs(api, target._id);
      const { token, hash } = generateApiToken(
        target._id,
        TEST_ENV.TOKEN_SECRET,
      );
      await api.users.updateOne({ _id: target._id }, { apiTokenHash: hash });
      const fresh = 'brand new passphrase 7';

      await setPassword('dave', {
        currentPassword: 'wrong guess',
        newPassword: fresh,
      })
        .expect(400)
        .expect(errorCode('invalid_credentials'));
      await setPassword('dave', {
        currentPassword: OLD,
        newPassword: 'dave1234',
      })
        .expect(400)
        .expect(issueCodes(['password_similar_to_identity']));
      await authed(
        api.http().get('/api/internal/profile'),
        targetSession,
      ).expect(200);

      await setPassword('dave', {
        currentPassword: OLD,
        newPassword: fresh,
      }).expect(204);
      await authed(
        api.http().get('/api/internal/profile'),
        targetSession,
      ).expect(401);
      await api
        .http()
        .get('/api/internal/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await api
        .http()
        .post('/api/internal/auth/login')
        .send({ username: 'dave', password: fresh })
        .expect(200);
      const after = (await api.users.findById(target._id).lean())!;
      expect(after.passwordSetBeforeVerification).toBe(false);
      const stored = after.password;
      const rows = await api.revisions
        .find({
          entity: 'user',
          entityId: target._id,
          action: 'staff_set_password',
        })
        .lean();
      expect(rows).toHaveLength(1);
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain(fresh);
      expect(serialized).not.toContain(stored);
      expect(String(rows[0].userId)).toBe(
        String((await api.users.findOne({ username: 'admin' }).lean())!._id),
      );
    });

    it('renews the e-mail lock while staff change an e-mail', async () => {
      await createUserWith(api, 'hana');
      const timers = jest.spyOn(global, 'setInterval');
      try {
        await authed(api.http().patch(`${USER('hana')}/profile`), admin)
          .send({ currentPassword: OLD, email: 'hana.new@example.com' })
          .expect(200);
        expect(timers.mock.calls.map(([, delay]) => delay)).toContain(10_000);
      } finally {
        timers.mockRestore();
      }
    });

    it('keeps e-mails unique case-insensitively, normalises the domain and audits the changed fields', async () => {
      const erin = await createUserWith(api, 'erin');
      await createUserWith(api, 'frank', { email: 'Frank@Example.com' });
      const patch = (body: object) =>
        authed(api.http().patch(`${USER('erin')}/profile`), admin).send(body);
      await patch({ email: 'frank@example.COM' })
        .expect(400)
        .expect(issueCodes(['email_taken']));
      await patch({ email: 'not-an-address' })
        .expect(400)
        .expect(issueCodes(['email_invalid']));
      await patch({ email: 'erin.new@example.com' })
        .expect(400)
        .expect(issueCodes(['password_required']));
      await patch({
        email: 'erin.new@example.com',
        currentPassword: 'wrong guess',
      })
        .expect(400)
        .expect(errorCode('invalid_credentials'));
      const organization = await createOrganization(api);
      const response = await patch({
        currentPassword: OLD,
        email: '  Erin.New@Example.COM ',
        displayName: 'Erin E.',
        organizations: [organization._id],
      }).expect(200);
      expect(dataOf<object>(response)).toMatchObject({
        email: 'Erin.New@example.com',
        displayName: 'Erin E.',
        organizations: [{ slug: organization.slug }],
      });
      const row = (await api.revisions
        .findOne({ entity: 'user', entityId: erin._id, action: 'staff_edit' })
        .lean())!;
      expect(Object.keys(row.changes).sort()).toEqual(
        ['displayName', 'email', 'organizations'].sort(),
      );
    });

    it('deactivates with auth.change_user only, signing the user out and never reclaimed as a stale signup; a banned account keeps its rank', async () => {
      const ivan = await createUserWith(api, 'ivan');
      const ivanSession = await loginAs(api, ivan._id);
      const patch = (name: string, body: object, session = admin) =>
        authed(api.http().patch(`${USER(name)}/profile`), session).send(body);
      await patch('ivan', { isActive: false }, editor)
        .expect(403)
        .expect(issueCodes(['activation_not_editable']));
      await patch('ivan', {
        isActive: false,
        displayRank: 'teacher',
        mute: true,
      }).expect(200);
      expect(await api.users.findById(ivan._id).lean()).toMatchObject({
        isActive: false,
        displayRank: 'teacher',
        mute: true,
      });
      await authed(api.http().get('/api/internal/profile'), ivanSession).expect(
        401,
      );
      await patch('ivan', { displayRank: 'banned' }).expect(400);
      await api.users.updateOne(
        { _id: ivan._id },
        { dateJoined: new Date('2020-01-01') },
      );
      await api
        .http()
        .post('/api/internal/auth/register')
        .send({
          username: 'ivan',
          email: 'other@example.com',
          password: 'a long passphrase 9',
        })
        .expect(400)
        .expect(issueCodes(['username_taken']));
      await patch('admin', { notes: 'x' }).expect(403);
      await createUserWith(api, 'jack', {
        banReason: 'spam',
        displayRank: 'banned',
        isActive: false,
      });
      await patch('jack', { isActive: true })
        .expect(409)
        .expect(issueCodes(['user_banned']));
      await patch('jack', { displayRank: 'user' })
        .expect(409)
        .expect(issueCodes(['user_banned']));
    });

    it('renames, keeping the old name pointing at the profile, and refuses a taken name', async () => {
      await createUserWith(api, 'kim');
      await createUserWith(api, 'lee');
      const rename = (name: string, username: string) =>
        authed(api.http().post(`${USER(name)}/rename`), admin).send({
          username,
        });
      await rename('kim', 'LEE')
        .expect(400)
        .expect(issueCodes(['username_taken']));
      await rename('kim', 'kim_new').expect(200);
      const page = await api.http().get('/api/internal/users/kim').expect(200);
      expect(dataOf<{ username: string }>(page).username).toBe('kim_new');
      await api
        .http()
        .post('/api/internal/auth/login')
        .send({ username: 'kim_new', password: OLD })
        .expect(200);
    });

    it('creates accounts row by row, with a generated password that signs in and an invite mail', async () => {
      const creator = await loginAs(
        api,
        (
          await createUserWith(api, 'creator', {
            permissions: ['auth.add_user'],
          })
        )._id,
      );
      await authed(api.http().post('/api/internal/admin/users'), admin)
        .send({ users: [{ username: 'nope' }] })
        .expect(403);
      api.mailer.sent.length = 0;
      const response = await authed(
        api.http().post('/api/internal/admin/users'),
        creator,
      )
        .send({
          users: [
            { username: 'pupil1', fullName: 'Pupil One' },
            { username: 'PUPIL1' },
            { username: 'pupil2', email: 'p2@example.com', invite: true },
            { username: 'pupil3', password: '12345678' },
          ],
        })
        .expect(201);
      const rows = dataOf<
        {
          username: string;
          status: string;
          generatedPassword: string | null;
          issues: { code: string }[];
        }[]
      >(response);
      expect(rows.map((row) => row.status)).toEqual([
        'created',
        'rejected',
        'created',
        'rejected',
      ]);
      expect(rows[1].issues.map((issue) => issue.code)).toEqual([
        'username_taken',
      ]);
      expect(rows[3].issues.map((issue) => issue.code)).toEqual([
        'password_numeric',
      ]);
      expect(rows[2].generatedPassword).toBeNull();
      expect(api.mailer.sent.map((mail) => mail.to)).toEqual([
        'p2@example.com',
      ]);
      await api
        .http()
        .post('/api/internal/auth/login')
        .send({ username: 'pupil1', password: rows[0].generatedPassword })
        .expect(200);
    });

    it('renews the e-mail lock while staff create an account with an e-mail', async () => {
      const creator = await loginAs(
        api,
        (
          await createUserWith(api, 'lockmaker', {
            permissions: ['auth.add_user'],
          })
        )._id,
      );
      const timers = jest.spyOn(global, 'setInterval');
      try {
        await authed(api.http().post('/api/internal/admin/users'), creator)
          .send({ users: [{ username: 'locked1', email: 'l1@example.com' }] })
          .expect(201);
        // The lock's renewal runs every third of its 30 s expiry.
        expect(timers.mock.calls.map(([, delay]) => delay)).toContain(10_000);
      } finally {
        timers.mockRestore();
      }
    });

    it('mails a reset link to an active user', async () => {
      await createUserWith(api, 'gina');
      api.mailer.sent.length = 0;
      await authed(
        api.http().post(`${USER('gina')}/password-reset`),
        admin,
      ).expect(204);
      expect(api.mailer.sent.map((mail) => mail.to)).toEqual([
        'gina@example.com',
      ]);
      await createUserWith(api, 'henry', { isActive: false });
      await authed(api.http().post(`${USER('henry')}/password-reset`), admin)
        .expect(409)
        .expect(issueCodes(['account_inactive']));
    });
  });
}

// roles and permissions
{
  const ADMIN = '/api/internal/admin';
  const access = (name: string) => `${ADMIN}/users/${name}/access`;

  describe('roles and permissions', () => {
    beforeAll(() => api.reset());
    let root: TestSession;
    let holder: TestSession;
    const change = (
      name: string,
      body: Record<string, unknown>,
      session = root,
    ) => authed(api.http().patch(access(name)), session).send(body);

    let rootId: string;
    let holderId: string;

    beforeAll(async () => {
      rootId = (await createUserWith(api, 'root', { isSuperuser: true }))._id;
      root = await loginAs(api, rootId);
      holderId = (
        await createUserWith(api, 'holder', {
          isStaff: true,
          permissions: Object.keys(PERMISSION_CATALOG),
        })
      )._id;
      holder = await loginAs(api, holderId);
    });

    it('lets a non-superuser holding every other permission read but never grant', async () => {
      const target = await createUserWith(api, 'target');
      const role = await api.groups.create({ name: 'Mods', permissions: [] });
      const read = await authed(
        api.http().get(access('target')),
        holder,
      ).expect(200);
      expect(dataOf<UserAccessResponse>(read)).toMatchObject({
        canEdit: false,
        permissions: [],
      });
      await authed(api.http().get(`${ADMIN}/permissions`), holder).expect(200);
      await authed(api.http().get(`${ADMIN}/groups`), holder).expect(200);
      await change(
        'target',
        { addPermissions: ['judge.ban_user'] },
        holder,
      ).expect(403);
      await change('holder', { isSuperuser: true }, holder).expect(403);
      await authed(api.http().post(`${ADMIN}/groups`), holder)
        .send({ name: 'Mine', permissions: ['judge.ban_user'] })
        .expect(403);
      await authed(api.http().patch(`${ADMIN}/groups/${role._id}`), holder)
        .send({ addPermissions: ['judge.ban_user'] })
        .expect(403);
      expect(await api.users.findById(target._id).lean()).toMatchObject({
        permissions: [],
        groups: [],
        isSuperuser: false,
      });
      expect(
        await api.groups.countDocuments({ permissions: { $ne: [] } }),
      ).toBe(0);
    });

    it('applies a grant, a role and a role edit to the next request, and audits it', async () => {
      const bob = await createUserWith(api, 'bob');
      await createUserWith(api, 'carol');
      const bobSession = await loginAs(api, bob._id);
      const carolProfile = () =>
        authed(api.http().get(`${ADMIN}/users/carol/profile`), bobSession);
      await carolProfile().expect(403);

      await change('bob', { addPermissions: ['judge.change_profile'] }).expect(
        200,
      );
      await carolProfile().expect(200);

      const role = dataOf<GroupResponse>(
        await authed(api.http().post(`${ADMIN}/groups`), root)
          .send({
            name: 'Profile editors',
            permissions: ['judge.change_profile'],
          })
          .expect(201),
      );
      const granted = await change('bob', {
        addGroups: [role.id],
        removePermissions: ['judge.change_profile'],
      }).expect(200);
      expect(dataOf<UserAccessResponse>(granted).effective).toEqual([
        {
          codename: 'judge.change_profile',
          direct: false,
          viaGroups: ['Profile editors'],
        },
      ]);
      await carolProfile().expect(200);

      await authed(api.http().patch(`${ADMIN}/groups/${role.id}`), root)
        .send({ removePermissions: ['judge.change_profile'] })
        .expect(200);
      await carolProfile().expect(403);

      await authed(api.http().post(`${ADMIN}/groups`), root)
        .send({ name: 'profile EDITORS' })
        .expect(409)
        .expect(issueCodes(['group_name_taken']));
      expect(
        await api.revisions
          .find({ entityId: bob._id, action: 'staff_set_access' })
          .lean(),
      ).toHaveLength(2);
    });

    it('keeps roles granted meanwhile, and a held legacy codename, but refuses unknown additions', async () => {
      const orgAdmin = await api.groups.create({ name: 'Org Admin' });
      await createUserWith(api, 'legacy', {
        permissions: ['judge.retired_perm'],
        groups: [orgAdmin._id],
      });
      const changed = await change('legacy', {
        addPermissions: ['judge.ban_user'],
      }).expect(200);
      expect(dataOf<UserAccessResponse>(changed)).toMatchObject({
        groups: [{ name: 'Org Admin' }],
        permissions: ['judge.ban_user', 'judge.retired_perm'],
      });
      await change('legacy', { addPermissions: ['judge.made_up'] })
        .expect(400)
        .expect(issueCodes(['permission_unknown']));
      await change('legacy', {
        addGroups: ['01890000-0000-7000-8000-000000000000'],
      })
        .expect(400)
        .expect(issueCodes(['group_unknown']));
      await change('legacy', {
        removePermissions: ['judge.retired_perm'],
      }).expect(200);
    });

    it('leaves one of two superusers active when they demote or deactivate each other at once', async () => {
      const [alpha, beta] = await Promise.all(
        ['alpha', 'beta'].map(async (name) => {
          const user = await createUserWith(api, name, { isSuperuser: true });
          return loginAs(api, user._id);
        }),
      );
      // Each removes the other's superuser power; without one lock and a caller re-read, both would win.
      const activeSuperusers = () =>
        api.users.countDocuments({
          username: { $in: ['alpha', 'beta'] },
          isSuperuser: true,
          isActive: true,
        });
      for (const [one, two] of [
        [
          change('beta', { isSuperuser: false }, alpha),
          change('alpha', { isSuperuser: false }, beta),
        ],
        [
          authed(api.http().patch(`${ADMIN}/users/beta/profile`), alpha).send({
            isActive: false,
          }),
          change('alpha', { isSuperuser: false }, beta),
        ],
      ]) {
        const statuses = (await Promise.all([one, two])).map(
          (response) => response.status,
        );
        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(await activeSuperusers()).toBe(1);
        await api.users.updateMany(
          { username: { $in: ['alpha', 'beta'] } },
          { $set: { isSuperuser: true, isActive: true } },
        );
      }
    });

    it("takes a superuser's API token and audits it as such; a staff token is refused like before", async () => {
      const target = await createUserWith(api, 'scripted');
      const bearer = async (id: string) => {
        const { token, hash } = generateApiToken(id, TEST_ENV.TOKEN_SECRET);
        await api.users.updateOne({ _id: id }, { apiTokenHash: hash });
        return `Bearer ${token}`;
      };
      const viaToken = (token: string, body: Record<string, unknown>) =>
        api
          .http()
          .patch(access('scripted'))
          .set('Authorization', token)
          .send(body);

      const granted = await viaToken(await bearer(rootId), {
        addPermissions: ['judge.ban_user'],
        isStaff: true,
      }).expect(200);
      expect(dataOf<UserAccessResponse>(granted)).toMatchObject({
        isStaff: true,
        permissions: ['judge.ban_user'],
      });
      await change('scripted', {
        removePermissions: ['judge.ban_user'],
      }).expect(200);
      const rows = await api.revisions
        .find({ entityId: target._id, action: 'staff_set_access' })
        .sort({ _id: 1 })
        .lean();
      expect(
        rows.map(({ userId, comment, changes }) => ({
          userId: String(userId),
          comment,
          fields: Object.keys(changes).sort(),
        })),
      ).toEqual([
        {
          userId: rootId,
          comment: 'via API token',
          fields: ['isStaff', 'permissions'],
        },
        { userId: rootId, comment: '', fields: ['permissions'] },
      ]);

      const refused = await viaToken(await bearer(holderId), {
        addPermissions: ['judge.ban_user'],
      })
        .expect(403)
        .expect(errorCode('forbidden'));
      expect(refused.body).toMatchObject({
        error: { message: 'This endpoint requires a browser session' },
      });
      expect(await api.users.findById(target._id).lean()).toMatchObject({
        permissions: [],
      });
    });

    it("keeps every other session-only route closed to a superuser's token, and the access change closed while impersonating", async () => {
      const victim = await createUserWith(api, 'victim');
      const unchanged = async () => {
        const row = (await api.users.findById(victim._id).lean())!;
        return {
          display: row.usernameDisplayOverride,
          password: row.password,
          permissions: row.permissions,
        };
      };
      const before = await unchanged();
      const { token, hash } = generateApiToken(rootId, TEST_ENV.TOKEN_SECRET);
      await api.users.updateOne({ _id: rootId }, { apiTokenHash: hash });
      const user = `${ADMIN}/users/victim`;
      for (const request of [
        api.http().patch(`${user}/profile`).send({ displayName: 'Owned' }),
        api.http().post(`${user}/password`).send({
          currentPassword: 'correct horse battery',
          newPassword: 'fresh passphrase 1',
        }),
        api.http().get(access('victim')),
        api.http().post(`${ADMIN}/groups`).send({ name: 'Scripted' }),
      ])
        await request
          .set('Authorization', `Bearer ${token}`)
          .expect(403)
          .expect(errorCode('forbidden'));
      expect(await unchanged()).toEqual(before);
      expect(await api.groups.countDocuments({ name: 'Scripted' })).toBe(0);

      const impersonator = await createUserWith(api, 'impersonator', {
        isSuperuser: true,
      });
      const { id, session } = await api.sessions.create({
        userId: rootId,
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: impersonator._id,
      });
      const impersonated = await api
        .http()
        .patch(access('victim'))
        .set('Cookie', sessionCookie(id))
        .set('X-CSRF-Token', session.csrf)
        .send({ addPermissions: ['judge.ban_user'] })
        .expect(403)
        .expect(errorCode('forbidden'));
      expect(impersonated.body).toMatchObject({
        error: { message: 'Not allowed while impersonating' },
      });
      expect(await unchanged()).toEqual(before);
    });

    it('never lets a superuser change their own access, and a demoted superuser loses it at once', async () => {
      const second = await loginAs(
        api,
        (await createUserWith(api, 'second', { isSuperuser: true }))._id,
      );
      await change('root', { isSuperuser: false }).expect(403);
      await change('second', { isSuperuser: false }).expect(200);
      await change('root', { isSuperuser: false }, second).expect(403);
      await authed(api.http().patch(`${ADMIN}/users/root/profile`), second)
        .send({ isActive: false })
        .expect(403);
      expect(
        await api.users.findOne({ username: 'root' }).lean(),
      ).toMatchObject({ isSuperuser: true, isActive: true });
    });
  });
}

// global change log
{
  const AUDIT = '/api/internal/admin/audit';

  describe('global change log', () => {
    let admin: TestSession;
    let editorId: string;
    let ids: string[];

    beforeAll(() => api.reset());
    beforeAll(async () => {
      const adminUser = await createUserWith(api, 'auditor', {
        permissions: ['judge.change_settings'],
      });
      admin = await loginAs(api, adminUser._id);
      const editor = await createUserWith(api, 'editor');
      editorId = editor._id;
      const settings = api.app.get<Model<SettingRevision>>(
        getModelToken(SettingRevision.name),
      );
      // Setup writes its own setting revisions; the feed here holds only this block's rows.
      await Promise.all([
        api.revisions.deleteMany({}),
        settings.deleteMany({}),
      ]);
      // Ids in write order, alternating between the two collections.
      ids = Array.from({ length: 5 }, () => newId()).sort();
      const revision = (id: string, userId: string | null) => ({
        _id: id,
        entity: 'user',
        entityId: editor._id,
        action: 'edit',
        userId,
        changes: { password: { before: 'old-hash', after: 'new-hash' } },
        comment: '',
      });
      const setting = (id: string, actor: string | null) => ({
        _id: id,
        key: 'mail.from',
        before: 'a@example.com',
        after: 'b@example.com',
        changedFields: ['value'],
        actor,
      });
      await api.revisions.create([
        revision(ids[0], editorId),
        revision(ids[2], adminUser._id),
        { ...revision(ids[4], null), entity: 'group', entityId: newId() },
      ]);
      await settings.create([
        setting(ids[1], adminUser._id),
        setting(ids[3], editorId),
      ]);
    });

    const feed = async (query: Record<string, string | number>) => ({
      body: dataOf<AuditFeedResponse>(
        await authed(api.http().get(AUDIT).query(query), admin).expect(200),
      ),
    });

    it('merges both collections newest first and pages without gaps or repeats', async () => {
      const seen: string[] = [];
      let before: string | null = null;
      do {
        const { body } = await feed({ limit: 2, ...(before && { before }) });
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items.map((item) => item.id));
        before = body.nextBefore;
      } while (before);
      expect(seen).toEqual([...ids].reverse());
    });

    it('names the actor and object and returns field names, never values', async () => {
      const { body } = await feed({ type: 'user' });
      expect(body.items).toHaveLength(2);
      expect(body.items[1]).toMatchObject({
        actor: { id: editorId, username: 'editor' },
        object: { id: editorId, label: 'editor', deleted: false },
        changedFields: ['password'],
      });
      expect(JSON.stringify(body)).not.toContain('hash');
      const groups = await feed({ type: 'group' });
      expect(groups.body.items[0]).toMatchObject({
        actor: null,
        object: { label: null, deleted: true },
      });
    });

    it('leaves out notes and superuser-only setting rows for a viewer without the matching permission', async () => {
      const [note, secret] = [newId(), newId()];
      const settings = api.app.get<Model<SettingRevision>>(
        getModelToken(SettingRevision.name),
      );
      await api.revisions.create({
        _id: note,
        entity: 'user',
        entityId: editorId,
        action: 'staff_send_reset_link',
        userId: editorId,
        changes: {},
        comment: 'Password reset link sent to editor@example.com',
      });
      await settings.create({
        _id: secret,
        key: 'auth.sessionMaxDays',
        before: 8,
        after: 9,
        changedFields: ['value'],
        actor: editorId,
      });
      try {
        const { body } = await feed({ limit: 50 });
        const seen = new Map(body.items.map((item) => [item.id, item]));
        expect(seen.get(note)?.comment).toBe('');
        expect(seen.has(secret)).toBe(false);
        const root = await loginAs(
          api,
          (
            await createUserWith(api, 'rootviewer', {
              isSuperuser: true,
              permissions: ['judge.change_settings'],
            })
          )._id,
        );
        const full = dataOf<AuditFeedResponse>(
          await authed(api.http().get(AUDIT).query({ limit: 50 }), root).expect(
            200,
          ),
        );
        expect(full.items.find((item) => item.id === note)?.comment).toContain(
          'editor@example.com',
        );
        expect(full.items.some((item) => item.id === secret)).toBe(true);
      } finally {
        await Promise.all([
          api.revisions.deleteOne({ _id: note }),
          settings.deleteOne({ _id: secret }),
        ]);
      }
    });

    it('filters by actor across both collections, and an unknown actor gives an empty feed', async () => {
      const { body } = await feed({ actor: 'EDITOR' });
      expect(body.items.map((item) => item.id)).toEqual([ids[3], ids[0]]);
      const settingsOnly = await feed({ actor: 'editor', type: 'setting' });
      expect(settingsOnly.body.items).toEqual([
        expect.objectContaining({
          id: ids[3],
          type: 'setting',
          object: { id: 'mail.from', label: 'mail.from', deleted: false },
        }),
      ]);
      const nobody = await feed({ actor: 'nobody' });
      expect(nobody.body).toEqual({ items: [], nextBefore: null });
    });

    it('filters by time range', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const { body } = await feed({ from: future });
      expect(body.items).toEqual([]);
      const all = await feed({ to: future });
      expect(all.body.items).toHaveLength(5);
    });

    it('is closed without judge.change_settings', async () => {
      const viewer = await loginAs(
        api,
        (await createUserWith(api, 'viewer'))._id,
      );
      await authed(api.http().get(AUDIT), viewer).expect(403);
    });
  });
}
