import { Controller, Get, Post } from '@nestjs/common';
import {
  AllowPartialAuth,
  AllowPwnedPassword,
  type AuthContext,
  CurrentAuth,
  generateApiToken,
  GroupsQuerier,
  Public,
  RequirePermission,
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
  @Get('private') read(@CurrentAuth() auth: AuthContext) {
    return auth.principal.username;
  }
  @Post('private') write() {
    return 'written';
  }
  @AllowPartialAuth() @AllowPwnedPassword() @Get('partial') partial() {
    return 'partial';
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
});
