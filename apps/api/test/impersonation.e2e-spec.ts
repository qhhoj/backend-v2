import { generateApiToken } from '@libs/auth';
import { REDIS } from '@libs/common';
import Redis from 'ioredis';
import {
  ApiTest,
  createUser,
  errorCode,
  sessionCookie,
  setupApiTest,
  TEST_ENV,
} from './setup';
import { SessionResponse } from '../src/modules/auth/core/dto/session.response';

const AUTH = '/api/internal/auth';
const IMPERSONATE = `${AUTH}/impersonate`;
const sessionOf = (response: { body: unknown }) =>
  (response.body as { data: SessionResponse }).data;
const cookieFrom = (headers: Record<string, unknown>) =>
  String((headers['set-cookie'] as string[])[0]).split(';')[0];

describe('impersonation', () => {
  let api: ApiTest;
  let adminId: string;
  let aliceId: string;
  let rootId: string;
  beforeAll(async () => {
    api = await setupApiTest();
    adminId = (
      await createUser(api.users, {
        username: 'admin',
        email: 'admin@example.com',
        isSuperuser: true,
      })
    )._id;
    aliceId = (await createUser(api.users, {}))._id;
    rootId = (
      await createUser(api.users, {
        username: 'root',
        email: 'root@example.com',
        isSuperuser: true,
      })
    )._id;
    await createUser(api.users, {
      username: 'dave',
      email: 'dave@example.com',
      isActive: false,
    });
    await createUser(api.users, {
      username: 'bob',
      email: 'bob@example.com',
    });
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    const redis = api.app.get<Redis>(REDIS);
    const keys = await redis.keys('rate:*');
    if (keys.length) await redis.del(...keys);
  });

  const login = async (username: string) => {
    const response = await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username, password: 'correct horse battery' })
      .expect(200);
    return {
      cookie: cookieFrom(response.headers),
      csrf: sessionOf(response).csrfToken!,
    };
  };
  const post = (
    path: string,
    session: { cookie: string; csrf: string },
    body: object = {},
  ) =>
    api
      .http()
      .post(path)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body);
  const me = (session: { cookie: string }) =>
    api.http().get(`${AUTH}/me`).set('Cookie', session.cookie);
  /** Logs in as admin and impersonates `userId`; returns the impersonation session. */
  const impersonate = async (userId: string) => {
    const response = await post(
      `${IMPERSONATE}/${userId}`,
      await login('admin'),
    ).expect(200);
    return {
      cookie: cookieFrom(response.headers),
      csrf: sessionOf(response).csrfToken!,
    };
  };

  it('impersonates a user, replacing the admin session, and stops back to the admin', async () => {
    const admin = await login('admin');
    const started = await post(`${IMPERSONATE}/${aliceId}`, admin).expect(200);
    const alice = {
      cookie: cookieFrom(started.headers),
      csrf: sessionOf(started).csrfToken!,
    };
    expect(sessionOf(started).user!.username).toBe('alice');
    expect(sessionOf(started).impersonatorId).toBe(adminId);
    await me(admin).expect(401);
    const current = await me(alice).expect(200);
    expect(sessionOf(current).user!.id).toBe(aliceId);
    expect(sessionOf(current).impersonatorId).toBe(adminId);

    const stopped = await post(`${IMPERSONATE}/stop`, alice).expect(200);
    expect(sessionOf(stopped).user!.id).toBe(adminId);
    expect(sessionOf(stopped).impersonatorId).toBeNull();
    await me(alice).expect(401);
    const restored = await me({ cookie: cookieFrom(stopped.headers) }).expect(
      200,
    );
    expect(sessionOf(restored).user!.id).toBe(adminId);
    expect(sessionOf(restored).impersonatorId).toBeNull();
  });

  it('does not record lastLogin for the target or the admin', async () => {
    const admin = await login('admin');
    const adminLastLogin = (await api.users.findById(adminId))!.lastLogin;
    const alice = {
      cookie: cookieFrom(
        (await post(`${IMPERSONATE}/${aliceId}`, admin).expect(200)).headers,
      ),
    };
    const aliceLastLogin = (await api.users.findById(aliceId))!.lastLogin;
    expect(aliceLastLogin).toBeNull();
    const aliceSession = await me(alice).expect(200);
    await post(`${IMPERSONATE}/stop`, {
      cookie: alice.cookie,
      csrf: sessionOf(aliceSession).csrfToken!,
    }).expect(200);
    expect((await api.users.findById(adminId))!.lastLogin).toEqual(
      adminLastLogin,
    );
    expect((await api.users.findById(aliceId))!.lastLogin).toBeNull();
  });

  it('refuses non-superusers', async () => {
    await post(`${IMPERSONATE}/${aliceId}`, await login('bob'))
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('refuses nested impersonation', async () => {
    const alice = await impersonate(aliceId);
    const bob = (await api.users.findOne({ username: 'bob' }))!._id;
    await post(`${IMPERSONATE}/${bob}`, alice)
      .expect(403)
      .expect(({ body }: { body: { error: { message: string } } }) =>
        expect(body.error.message).toBe('Already impersonating'),
      );
  });

  it('refuses to impersonate a superuser', async () => {
    await post(`${IMPERSONATE}/${rootId}`, await login('admin'))
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('answers 404 for unknown, malformed and inactive targets', async () => {
    const admin = await login('admin');
    const inactive = (await api.users.findOne({ username: 'dave' }))!._id;
    for (const target of [
      '01900000-0000-7000-8000-000000000000',
      'not-a-uuid',
      '%27%20OR%201',
      inactive,
    ])
      await post(`${IMPERSONATE}/${target}`, admin)
        .expect(404)
        .expect(errorCode('not_found'));
  });

  it('refuses a Bearer token', async () => {
    const { token, hash } = generateApiToken(adminId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: adminId }, { apiTokenHash: hash });
    await api
      .http()
      .post(`${IMPERSONATE}/${aliceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('answers 400 not_impersonating on stop outside impersonation, not 404', async () => {
    await post(`${IMPERSONATE}/stop`, await login('admin'))
      .expect(400)
      .expect(errorCode('not_impersonating'));
  });

  it('restores the admin with a passed second factor', async () => {
    await api.users.updateOne({ _id: adminId }, { isTotpEnabled: true });
    const { id, session } = await api.sessions.create({
      userId: aliceId,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: adminId,
    });
    const stopped = await post(`${IMPERSONATE}/stop`, {
      cookie: sessionCookie(id),
      csrf: session.csrf,
    }).expect(200);
    await api.users.updateOne({ _id: adminId }, { isTotpEnabled: false });
    expect(sessionOf(stopped).user!.id).toBe(adminId);
    expect(sessionOf(stopped).twoFactorRequired).toBe(false);
    expect(sessionOf(stopped).passwordChangeRequired).toBe(false);
  });

  it('ends the impersonation session when the impersonator is demoted', async () => {
    const alice = await impersonate(aliceId);
    await api.users.updateOne({ _id: adminId }, { isSuperuser: false });
    try {
      await me(alice).expect(401).expect(errorCode('unauthorized'));
      expect(await api.sessions.get(alice.cookie.split('=')[1])).toBeNull();
    } finally {
      await api.users.updateOne({ _id: adminId }, { isSuperuser: true });
    }
  });

  it('refuses every account-security route while impersonating', async () => {
    const alice = await impersonate(aliceId);
    const routes = [
      ['post', `${AUTH}/2fa/totp/enroll`],
      ['post', `${AUTH}/2fa/totp/confirm`],
      ['post', `${AUTH}/2fa/totp/disable`],
      ['post', `${AUTH}/2fa/totp/scratch-codes`],
      ['post', `${AUTH}/2fa/webauthn/register/options`],
      ['post', `${AUTH}/2fa/webauthn/register/verify`],
      ['delete', `${AUTH}/2fa/webauthn/credentials/abc`],
      ['post', `${AUTH}/token/regenerate`],
      ['post', `${AUTH}/password/change`],
    ] as const;
    for (const [method, path] of routes)
      await api
        .http()
        [method](path)
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrf)
        .send({})
        .expect(403)
        .expect(errorCode('forbidden'));
    await post(`${AUTH}/2fa/totp/enroll`, await login('bob'), {
      currentPassword: 'correct horse battery',
    }).expect(201);
  });
});
