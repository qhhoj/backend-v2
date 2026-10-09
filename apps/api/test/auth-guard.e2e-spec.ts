import { Controller, Get, Post } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import Redis from 'ioredis';
import type { Model } from 'mongoose';
import { REDIS } from '@libs/common';
import {
  AllowBeforeTwoFactor,
  AllowPwnedPassword,
  type AuthContext,
  COOKIE_REFRESH_MS,
  CurrentAuth,
  CurrentServiceClient,
  generateApiToken,
  generateServiceKey,
  GroupsQuerier,
  NoImpersonation,
  Public,
  RequirePermission,
  RequireScope,
  type ServiceClientPrincipal,
  ServiceOnly,
  SessionOnly,
  sha256,
} from '@libs/auth';
import { IntegrationClient } from '@libs/database';
import {
  ApiTest,
  createUser,
  errorCode,
  sessionCookie,
  setupApiTest,
  TEST_ENV,
} from './setup';

@Controller('guarded')
class GuardedController {
  @Public() @Get('public') open() {
    return 'open';
  }
  @Public() @Post('public-write') openWrite() {
    return 'open';
  }
  @Get('private') read(@CurrentAuth() auth: AuthContext) {
    return auth.principal.username;
  }
  @Post('private') write() {
    return 'written';
  }
  @Get('context') context(@CurrentAuth() auth: AuthContext) {
    return { viaToken: auth.viaToken, hasSession: auth.sessionId !== null };
  }
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @Get('before-two-factor')
  beforeTwoFactor() {
    return 'before two-factor';
  }
  @SessionOnly() @Post('session-only') sessionOnly() {
    return 'managed';
  }
  @RequirePermission('judge.edit_all_problem') @Get('editor') editor() {
    return 'editor';
  }
  @SessionOnly()
  @NoImpersonation()
  @RequirePermission('judge.edit_all_problem')
  @Get('account-security')
  accountSecurity() {
    return 'secured';
  }
  @ServiceOnly()
  @RequireScope('contests:read')
  @Get('service')
  service(@CurrentServiceClient() client: ServiceClientPrincipal) {
    return client.name;
  }
  @ServiceOnly()
  @RequireScope('contests:write')
  @Post('service-write')
  serviceWrite() {
    return 'written';
  }
  @ServiceOnly()
  @Get('service-unscoped')
  serviceUnscoped() {
    return 'unscoped';
  }
}

/** One hour past the refresh window, so the guard re-issues the cookie. */
const STALE_COOKIE_AGE_MS = COOKIE_REFRESH_MS + 60 * 60 * 1000;

const errorMessage =
  (message: string) =>
  ({ body }: { body: { error: { message: string } } }) =>
    expect(body.error.message).toBe(message);

describe('AuthGuard', () => {
  let api: ApiTest;
  let userId: string;
  const login = async (
    flags: Partial<{
      twoFaPassed: boolean;
      passwordPwned: boolean;
      impersonatorId: string | null;
    }> = {},
    id = userId,
  ) =>
    await api.sessions.create({
      userId: id,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: null,
      ...flags,
    });

  beforeAll(async () => {
    api = await setupApiTest({ controllers: [GuardedController] });
    userId = (await createUser(api.users, {}))._id;
  });
  afterAll(() => api.teardown());
  const createSuperuser = async (username: string) =>
    (
      await createUser(api.users, {
        username,
        email: `${username}@example.com`,
        isSuperuser: true,
      })
    )._id;
  const useApiToken = async (id = userId) => {
    const { token, hash } = generateApiToken(id, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: id }, { apiTokenHash: hash });
    return `Bearer ${token}`;
  };

  it('lets anyone reach public routes and rejects anonymous private ones', async () => {
    await api.http().get('/guarded/public').expect(200, { data: 'open' });
    await api
      .http()
      .get('/guarded/private')
      .expect(401)
      .expect(errorCode('unauthorized'));
  });
  it('authenticates a session cookie', async () => {
    const { id } = await login();
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .expect(200, { data: 'alice' });
  });
  it('requires the csrf token on unsafe methods for cookie sessions', async () => {
    const { id, session } = await login();
    await api
      .http()
      .post('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .expect(403)
      .expect(errorCode('csrf_failed'));
    await api
      .http()
      .post('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .set('X-CSRF-Token', 'wrong')
      .expect(403);
    await api
      .http()
      .post('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .set('X-CSRF-Token', session.csrf)
      .expect(201, { data: 'written' });
  });
  it('blocks 2FA-pending and pwned sessions except on opted-in routes', async () => {
    const pending = await login({ twoFaPassed: false });
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(pending.id))
      .expect(403)
      .expect(errorCode('two_factor_required'));
    await api
      .http()
      .get('/guarded/before-two-factor')
      .set('Cookie', sessionCookie(pending.id))
      .expect(200);
    const pwned = await login({ passwordPwned: true });
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(pwned.id))
      .expect(403)
      .expect(errorCode('password_change_required'));
    await api
      .http()
      .get('/guarded/before-two-factor')
      .set('Cookie', sessionCookie(pwned.id))
      .expect(200);
  });
  it('checks permissions from groups, user grants and superuser', async () => {
    const plain = await login();
    await api
      .http()
      .get('/guarded/editor')
      .set('Cookie', sessionCookie(plain.id))
      .expect(403)
      .expect(errorCode('forbidden'));
    const editors = await api.groups.create({
      name: 'Editors',
      permissions: ['judge.edit_all_problem'],
    });
    const editor = await createUser(api.users, {
      username: 'eve',
      email: 'eve@example.com',
      groups: [editors._id],
    });
    await api.app.get(GroupsQuerier).resync();
    await api
      .http()
      .get('/guarded/editor')
      .set('Cookie', sessionCookie((await login({}, editor._id)).id))
      .expect(200);
    const root = await createUser(api.users, {
      username: 'root',
      email: 'root@example.com',
      isSuperuser: true,
    });
    await api
      .http()
      .get('/guarded/editor')
      .set('Cookie', sessionCookie((await login({}, root._id)).id))
      .expect(200);
  });
  it('treats sessions of deactivated users as anonymous', async () => {
    const banned = await createUser(api.users, {
      username: 'mallory',
      email: 'm@example.com',
    });
    const { id } = await login({}, banned._id);
    await api.users.updateOne(
      { _id: banned._id },
      { isActive: false, banReason: 'spam' },
    );
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .expect(401);
    expect(await api.sessions.get(id)).toBeNull();
    expect(
      await api.app.get<Redis>(REDIS).exists(`session:${sha256(id)}`),
    ).toBe(0);
  });
  it('authenticates bearer tokens without csrf and rejects bad ones', async () => {
    const { token, hash } = generateApiToken(userId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: userId }, { apiTokenHash: hash });
    await api
      .http()
      .post('/guarded/private')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await api
      .http()
      .get('/guarded/private')
      .set('Authorization', `Bearer ${'A'.repeat(64)}`)
      .expect(401);
  });
  it('refuses bearer tokens on session-only routes', async () => {
    const { token, hash } = generateApiToken(userId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: userId }, { apiTokenHash: hash });
    await api
      .http()
      .post('/guarded/session-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
      .expect(errorCode('forbidden'));
    const { id, session } = await login();
    await api
      .http()
      .post('/guarded/session-only')
      .set('Cookie', sessionCookie(id))
      .set('X-CSRF-Token', session.csrf)
      .expect(201);
  });
  it('compares csrf tokens of equal length and equal byte length safely', async () => {
    const { id, session } = await login();
    const post = () =>
      api.http().post('/guarded/private').set('Cookie', sessionCookie(id));
    await post()
      .set('X-CSRF-Token', 'x'.repeat(session.csrf.length))
      .expect(403)
      .expect(errorCode('csrf_failed'));
    await post()
      .set('X-CSRF-Token', `${'x'.repeat(session.csrf.length - 1)}\u00e9`)
      .expect(403)
      .expect(errorCode('csrf_failed'));
  });
  it('does not require csrf on HEAD', async () => {
    const { id } = await login();
    await api
      .http()
      .head('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .expect(200);
    await api.http().head('/guarded/private').expect(401);
  });
  it('rejects an invalid bearer token even with a valid session cookie', async () => {
    const { id } = await login();
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .set('Authorization', `Bearer ${'A'.repeat(64)}`)
      .expect(401);
  });
  it('accepts a lowercase bearer scheme', async () => {
    const { token, hash } = generateApiToken(userId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: userId }, { apiTokenHash: hash });
    await api
      .http()
      .get('/guarded/private')
      .set('Authorization', `bearer ${token}`)
      .expect(200);
  });
  it.each(['Bearer', 'Bearer ', 'Bearer  x', 'bearer a b'])(
    'rejects malformed bearer header %j',
    async (header) => {
      await api
        .http()
        .get('/guarded/private')
        .set('Authorization', header)
        .expect(401);
    },
  );
  it('rejects bearer tokens of inactive users', async () => {
    const inactive = await createUser(api.users, {
      username: 'trent',
      email: 't@example.com',
    });
    const { token, hash } = generateApiToken(
      inactive._id,
      TEST_ENV.TOKEN_SECRET,
    );
    await api.users.updateOne(
      { _id: inactive._id },
      { apiTokenHash: hash, isActive: false },
    );
    await api
      .http()
      .get('/guarded/private')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
  it('reports how the request was authenticated', async () => {
    const { token, hash } = generateApiToken(userId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: userId }, { apiTokenHash: hash });
    await api
      .http()
      .get('/guarded/context')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { data: { viaToken: true, hasSession: false } });
    const { id } = await login();
    await api
      .http()
      .get('/guarded/context')
      .set('Cookie', sessionCookie(id))
      .expect(200, { data: { viaToken: false, hasSession: true } });
  });
  it('rejects cross-origin unsafe requests, even on public routes', async () => {
    const login = () => api.http().post('/api/internal/auth/login');
    await login()
      .set('Origin', 'https://evil.example')
      .send({ username: 'alice', password: 'x' })
      .expect(403)
      .expect(errorCode('csrf_failed'));
    await login()
      .set('Origin', 'http://localhost:5173')
      .send({ username: 'alice', password: 'wrong password' })
      .expect(401);
    await login()
      .send({ username: 'alice', password: 'wrong password' })
      .expect(401);
    await api
      .http()
      .post('/guarded/public-write')
      .set('Origin', 'https://evil.example')
      .expect(403)
      .expect(errorCode('csrf_failed'));
  });
  it('rejects cross-site and null origins even with a valid session and csrf token', async () => {
    const { id, session } = await login();
    for (const origin of ['https://evil.example', 'null'])
      await api
        .http()
        .post('/guarded/private')
        .set('Cookie', sessionCookie(id))
        .set('X-CSRF-Token', session.csrf)
        .set('Origin', origin)
        .expect(403)
        .expect(errorCode('csrf_failed'));
  });
  it('lets bearer clients through regardless of Origin', async () => {
    const { token, hash } = generateApiToken(userId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: userId }, { apiTokenHash: hash });
    await api
      .http()
      .post('/guarded/private')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://elsewhere.example')
      .expect(201);
  });
  it('re-issues the session cookie once a day of activity has passed', async () => {
    const { id } = await login();
    await api.sessions.update(id, {
      cookieIssuedAt: Date.now() - STALE_COOKIE_AGE_MS,
    });
    const refreshed = await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .expect(200);
    expect(String(refreshed.headers['set-cookie'])).toContain(
      `qhhoj_session=${id}`,
    );
    const quiet = await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .expect(200);
    expect(quiet.headers['set-cookie']).toBeUndefined();
  });
  it('reads sessions stored without the newer fields', async () => {
    const { id } = await api.sessions.create({
      userId,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: null,
    });
    const legacy = {
      userId,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: null,
      csrf: 'legacy',
    };
    await api.app
      .get<Redis>(REDIS)
      .set(`session:${sha256(id)}`, JSON.stringify(legacy), 'KEEPTTL');
    expect(await api.sessions.get(id)).toEqual({
      ...legacy,
      cookieIssuedAt: 0,
      pendingTotpSecret: null,
      webauthnChallenge: null,
      webauthnRegistrationChallenge: null,
    });
  });

  it('reports the first failing check: csrf, then two-factor, then the pwned password', async () => {
    const both = await login({ twoFaPassed: false, passwordPwned: true });
    await api
      .http()
      .post('/guarded/private')
      .set('Cookie', sessionCookie(both.id))
      .expect(403)
      .expect(errorCode('csrf_failed'));
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', sessionCookie(both.id))
      .expect(403)
      .expect(errorCode('two_factor_required'));
  });
  it('asks for a login before checking permissions', async () => {
    await api
      .http()
      .get('/guarded/editor')
      .expect(401)
      .expect(errorCode('unauthorized'));
    await api
      .http()
      .post('/guarded/session-only')
      .expect(401)
      .expect(errorCode('unauthorized'));
  });
  it('applies the session rules before the permission check', async () => {
    const pending = await login({ twoFaPassed: false });
    await api
      .http()
      .get('/guarded/editor')
      .set('Cookie', sessionCookie(pending.id))
      .expect(403)
      .expect(errorCode('two_factor_required'));
  });
  it('skips every session rule on public routes', async () => {
    const pending = await login({ twoFaPassed: false, passwordPwned: true });
    await api
      .http()
      .get('/guarded/public')
      .set('Cookie', sessionCookie(pending.id))
      .expect(200, { data: 'open' });
    await api
      .http()
      .post('/guarded/public-write')
      .set('Cookie', sessionCookie(pending.id))
      .expect(201, { data: 'open' });
  });
  it('authenticates before deciding a route is public', async () => {
    await api
      .http()
      .get('/guarded/public')
      .set('Authorization', `Bearer ${'A'.repeat(64)}`)
      .expect(401)
      .expect(errorCode('unauthorized'));
  });
  it('treats an unknown session cookie as anonymous', async () => {
    const unknown = sessionCookie('A'.repeat(43));
    await api.http().get('/guarded/public').set('Cookie', unknown).expect(200);
    await api
      .http()
      .get('/guarded/private')
      .set('Cookie', unknown)
      .expect(401)
      .expect(errorCode('unauthorized'));
  });
  it('refuses a cross-origin request before reading the session', async () => {
    const inactive = await createUser(api.users, {
      username: 'oscar',
      email: 'oscar@example.com',
    });
    const { id } = await login({}, inactive._id);
    await api.users.updateOne({ _id: inactive._id }, { isActive: false });
    await api
      .http()
      .post('/guarded/private')
      .set('Cookie', sessionCookie(id))
      .set('Origin', 'https://evil.example')
      .expect(403)
      .expect(errorCode('csrf_failed'));
    expect(await api.sessions.get(id)).not.toBeNull();
  });
  it('re-issues an old session cookie on public routes too', async () => {
    const { id } = await login();
    await api.sessions.update(id, {
      cookieIssuedAt: Date.now() - STALE_COOKIE_AGE_MS,
    });
    const refreshed = await api
      .http()
      .get('/guarded/public')
      .set('Cookie', sessionCookie(id))
      .expect(200);
    expect(String(refreshed.headers['set-cookie'])).toContain(
      `qhhoj_session=${id}`,
    );
  });
  it('checks bearer tokens against permissions', async () => {
    await api
      .http()
      .get('/guarded/editor')
      .set('Authorization', await useApiToken())
      .expect(403)
      .expect(errorCode('forbidden'))
      .expect(errorMessage('Permission denied'));
  });
  it('reports the first failing check: session-only, pwned password, impersonation, then permission', async () => {
    const impersonatorId = await createSuperuser('ivan');
    const route = () => api.http().get('/guarded/account-security');
    await route()
      .set('Authorization', await useApiToken())
      .expect(403)
      .expect(errorMessage('This endpoint requires a browser session'));
    const pwnedImpersonation = await login({
      passwordPwned: true,
      impersonatorId,
    });
    await route()
      .set('Cookie', sessionCookie(pwnedImpersonation.id))
      .expect(403)
      .expect(errorCode('password_change_required'));
    const impersonation = await login({ impersonatorId });
    await route()
      .set('Cookie', sessionCookie(impersonation.id))
      .expect(403)
      .expect(errorCode('forbidden'))
      .expect(errorMessage('Not allowed while impersonating'));
    await route()
      .set('Cookie', sessionCookie((await login()).id))
      .expect(403)
      .expect(errorCode('forbidden'))
      .expect(errorMessage('Permission denied'));
    await route()
      .set('Cookie', sessionCookie((await login({}, impersonatorId)).id))
      .expect(200, { data: 'secured' });
  });
  describe('integration clients', () => {
    let clients: Model<IntegrationClient>;
    const LOCAL = ['127.0.0.0/8', '::1/128'];
    const HOUR_MS = 60 * 60 * 1000;
    const makeClient = async (extra: Partial<IntegrationClient> = {}) => {
      const { key, hash } = generateServiceKey();
      const client = await clients.create({
        name: 'bridge',
        keyHash: hash,
        keyPrefix: key.slice(0, 8),
        scopes: ['contests:read', 'contests:write'],
        allowedCidrs: LOCAL,
        actsAs: userId,
        createdBy: userId,
        ...extra,
      });
      return { client, key, bearer: `Bearer ${key}` };
    };
    const serviceRoute = (bearer: string) =>
      api.http().get('/guarded/service').set('Authorization', bearer);
    beforeAll(() => {
      clients = api.app.get(getModelToken(IntegrationClient.name));
    });
    beforeEach(async () => {
      const redis = api.app.get<Redis>(REDIS);
      const keys = await redis.keys('rate:service-key-failures:*');
      if (keys.length) await redis.del(...keys);
    });

    it('authenticates a key on a service route without cookies, CSRF or an origin check, and stamps its last use', async () => {
      const { client, bearer } = await makeClient({ name: 'judge-bridge' });
      await serviceRoute(bearer).expect(200, { data: 'judge-bridge' });
      await api
        .http()
        .post('/guarded/service-write')
        .set('Authorization', bearer)
        .set('Origin', 'https://evil.example')
        .expect(201, { data: 'written' });
      expect(
        (await clients.findById(client._id).lean())?.lastUsedAt,
      ).toBeInstanceOf(Date);
    });

    it('never lets a key act as a user: user routes and public routes answer 401', async () => {
      const { bearer } = await makeClient();
      await api
        .http()
        .get('/guarded/private')
        .set('Authorization', bearer)
        .expect(401)
        .expect(errorCode('unauthorized'));
      await api
        .http()
        .get('/guarded/public')
        .set('Authorization', bearer)
        .expect(401);
      await api
        .http()
        .post('/guarded/private')
        .set('Authorization', bearer)
        .expect(401);
    });

    it('refuses every user credential on a service route with 403, and anonymous callers with 401', async () => {
      const { bearer } = await makeClient();
      const route = () => api.http().get('/guarded/service');
      await route()
        .set('Authorization', await useApiToken())
        .expect(403)
        .expect(errorCode('forbidden'));
      await route()
        .set('Cookie', sessionCookie((await login()).id))
        .expect(403);
      await route()
        .set('Cookie', sessionCookie((await login()).id))
        .set('Authorization', bearer)
        .expect(403);
      await route().set('Authorization', 'Bearer not-a-key').expect(403);
      await route().expect(401).expect(errorCode('unauthorized'));
    });

    it('answers 401 for a malformed, unknown or revoked key, at once', async () => {
      await serviceRoute('Bearer qhi_short').expect(401);
      await serviceRoute(`Bearer ${generateServiceKey().key}`).expect(401);
      const { client, bearer } = await makeClient();
      await serviceRoute(bearer).expect(200);
      await clients.updateOne(
        { _id: client._id },
        { $set: { revokedAt: new Date() } },
      );
      await serviceRoute(bearer).expect(401).expect(errorCode('unauthorized'));
    });

    it('answers 401 for an expired key, and accepts one that expires later', async () => {
      const { bearer: later } = await makeClient({
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
      await serviceRoute(later).expect(200);
      const { client, bearer } = await makeClient({
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
      await serviceRoute(bearer).expect(200);
      await clients.updateOne(
        { _id: client._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      await serviceRoute(bearer).expect(401).expect(errorCode('unauthorized'));
    });

    it('throttles invalid keys per address and answers 429 before looking anything up', async () => {
      for (let attempt = 0; attempt < 20; attempt += 1)
        await serviceRoute(`Bearer ${generateServiceKey().key}`).expect(401);
      await serviceRoute(`Bearer ${generateServiceKey().key}`)
        .expect(429)
        .expect(errorCode('rate_limited'));
      const { bearer } = await makeClient();
      await serviceRoute(bearer).expect(429);
    });

    it('refuses an address outside the client CIDRs and a client with none', async () => {
      const { bearer: elsewhere } = await makeClient({
        allowedCidrs: ['10.0.0.0/8'],
      });
      await serviceRoute(elsewhere).expect(403).expect(errorCode('forbidden'));
      const { bearer: none } = await makeClient({ allowedCidrs: [] });
      await serviceRoute(none).expect(403);
    });

    it('refuses every key on a service route that declares no scope', async () => {
      const { bearer } = await makeClient();
      await api
        .http()
        .get('/guarded/service-unscoped')
        .set('Authorization', bearer)
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('refuses a route whose scope the client does not hold', async () => {
      const { bearer } = await makeClient({ scopes: ['contests:read'] });
      await serviceRoute(bearer).expect(200);
      await api
        .http()
        .post('/guarded/service-write')
        .set('Authorization', bearer)
        .expect(403)
        .expect(errorCode('forbidden'));
    });
  });
});
