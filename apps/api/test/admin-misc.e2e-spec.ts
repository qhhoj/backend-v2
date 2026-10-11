import { CONTEST_CHEATING_BAN_REASON } from '../src/modules/contests/participation/contest-participation.service';

import { authed, createUserWith, loginAs } from './problem-fixtures';

import {
  setupApiTest,
  errorCode,
  createUser,
  sessionCookie,
  TEST_ENV,
} from './setup';

import type { ApiTest } from './setup';

import { profileQueries } from '@libs/database/testing';

import type { StaffUserResponse } from '../src/modules/users/admin/dto/staff-user.response';

import type { TestSession } from './problem-fixtures';

import {
  dataOf,
  bridgeCommands,
  clearBridgeCommands,
} from './submission-fixtures';

import { sha256, generateApiToken } from '@libs/auth';

import { getModelToken } from '@nestjs/mongoose';

import { IntegrationClient } from '@libs/database';

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
      await authed(
        api.http().post('/api/internal/users/target/unban'),
        moderator,
      ).expect(409);
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

    it('resets two-factor for staff only, never a superuser, signs the user out and leaves an audit row', async () => {
      const staff = await loginAs(
        api,
        (
          await createUserWith(api, 'recovery', {
            permissions: ['judge.ban_user'],
          })
        )._id,
      );
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
