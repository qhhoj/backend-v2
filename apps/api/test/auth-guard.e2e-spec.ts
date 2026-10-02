import { Controller, Get, Post } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import {
  AllowPartialAuth,
  AllowPwnedPassword,
  type AuthContext,
  CurrentAuth,
  generateApiToken,
  GroupsQuerier,
  Public,
  RequirePermission,
  SessionOnly,
  sha256,
} from '@libs/auth';
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
  @AllowPartialAuth() @AllowPwnedPassword() @Get('partial') partial() {
    return 'partial';
  }
  @SessionOnly() @Post('session-only') sessionOnly() {
    return 'managed';
  }
  @RequirePermission('judge.edit_all_problem') @Get('editor') editor() {
    return 'editor';
  }
}

describe('AuthGuard', () => {
  let api: ApiTest;
  let userId: string;
  const login = async (
    flags: Partial<{ twoFaPassed: boolean; passwordPwned: boolean }> = {},
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
      .get('/guarded/partial')
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
      .get('/guarded/partial')
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
      cookieIssuedAt: Date.now() - 25 * 60 * 60 * 1000,
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
    });
  });
});
