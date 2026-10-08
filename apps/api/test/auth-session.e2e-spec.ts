import { hashPassword, PASSWORD_ITERATIONS, UsersRepository } from '@libs/auth';
import { REDIS } from '@libs/common';
import { newId } from '@libs/database';
import Redis from 'ioredis';
import { loginAs } from './problem-fixtures';
import { ApiTest, createUser, errorCode, setupApiTest } from './setup';

import { SessionResponse } from '../src/modules/auth/core/dto/session.response';

const sessionOf = (response: { body: unknown }) =>
  (response.body as { data: SessionResponse }).data;
const LOGIN = '/api/internal/auth/login';
const ME = '/api/internal/auth/me';
const cookieFrom = (headers: Record<string, unknown>) =>
  String((headers['set-cookie'] as string[])[0]).split(';')[0];

const defaultLanguageId = newId();

describe('auth session endpoints', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
    await createUser(api.users, {
      username: 'Alice',
      siteTheme: 'glass',
      languageId: defaultLanguageId,
    });
    await createUser(api.users, {
      username: 'carol',
      email: 'carol@example.com',
      isActive: false,
      banReason: 'spam',
    });
    await createUser(api.users, {
      username: 'dave',
      email: 'dave@example.com',
      isActive: false,
    });
    await createUser(api.users, {
      username: 'tina',
      email: 'tina@example.com',
      isTotpEnabled: true,
    });
  });
  afterAll(() => api.teardown());

  it('logs in case-insensitively, sets a hardened cookie and returns the session', async () => {
    const response = await api
      .http()
      .post(LOGIN)
      .send({ username: 'ALICE', password: 'correct horse battery' })
      .expect(200);
    const cookie = String(response.headers['set-cookie'][0]);
    expect(cookie).toMatch(/^qhhoj_session=[A-Za-z0-9_-]{43};/);
    for (const attribute of [
      'Max-Age=1209600',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ])
      expect(cookie).toContain(attribute);
    expect(cookie).not.toContain('Secure');
    expect(sessionOf(response)).toMatchObject({
      user: { username: 'Alice', permissions: [] },
      twoFactorRequired: false,
      passwordChangeRequired: false,
    });
    expect(sessionOf(response).csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(response.headers))
      .expect(200)
      .expect(({ body }) =>
        expect(sessionOf({ body }).user?.username).toBe('Alice'),
      );
  });
  it('carries the theme and the default language on the session user', async () => {
    const response = await api
      .http()
      .post(LOGIN)
      .send({ username: 'Alice', password: 'correct horse battery' })
      .expect(200);
    expect(sessionOf(response).user).toMatchObject({
      siteTheme: 'glass',
      languageId: defaultLanguageId,
    });
    expect(sessionOf(response).twoFactor).toBeNull();
  });

  it('shows the pending second factors and the username, and still no user, on a partial session', async () => {
    const login = await api
      .http()
      .post(LOGIN)
      .send({ username: 'tina', password: 'correct horse battery' })
      .expect(200);
    const me = await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(login.headers))
      .expect(200);
    expect(sessionOf(me)).toMatchObject({
      user: null,
      twoFactorRequired: true,
      twoFactor: { username: 'tina', methods: ['totp'] },
    });
    expect(Object.keys(sessionOf(me).twoFactor!).sort()).toEqual([
      'methods',
      'username',
    ]);
  });

  it('lists both methods when both are enabled', async () => {
    await createUser(api.users, {
      username: 'both',
      email: 'both@example.com',
      isTotpEnabled: true,
      isWebauthnEnabled: true,
    });
    const login = await api
      .http()
      .post(LOGIN)
      .send({ username: 'both', password: 'correct horse battery' })
      .expect(200);
    expect(sessionOf(login).twoFactor?.methods).toEqual(['totp', 'webauthn']);
  });

  it('upgrades weak password hashes on login', async () => {
    await createUser(api.users, { username: 'bob', email: 'bob@example.com' });
    const before = (await api.users.findOne({ username: 'bob' }))!.password;
    expect(before).toMatch(/^pbkdf2_sha256\$1000\$/);
    await api
      .http()
      .post(LOGIN)
      .send({ username: 'bob', password: 'correct horse battery' })
      .expect(200);
    expect((await api.users.findOne({ username: 'bob' }))!.password).toMatch(
      new RegExp(`^pbkdf2_sha256\\$${PASSWORD_ITERATIONS}\\$`),
    );
  });
  it('refuses banned and inactive accounts before any rehash', async () => {
    for (const username of ['carol', 'dave']) {
      const before = (await api.users.findOne({ username }))!.password;
      expect(before).toMatch(/^pbkdf2_sha256\$1000\$/);
      await api
        .http()
        .post(LOGIN)
        .send({ username, password: 'correct horse battery' })
        .expect(403);
      expect((await api.users.findOne({ username }))!.password).toBe(before);
    }
  });
  it('keeps a password changed between verify and rehash', async () => {
    await createUser(api.users, { username: 'rex', email: 'rex@example.com' });
    const repository = api.app.get(UsersRepository);
    const original = repository.updatePasswordIfUnchanged.bind(repository);
    const newer = await hashPassword('newer passphrase 42');
    const spy = jest
      .spyOn(repository, 'updatePasswordIfUnchanged')
      .mockImplementationOnce(async (userId, expected, replacement) => {
        await api.users.updateOne({ username: 'rex' }, { password: newer });
        return original(userId, expected, replacement);
      });
    try {
      await api
        .http()
        .post(LOGIN)
        .send({ username: 'rex', password: 'correct horse battery' })
        .expect(200);
    } finally {
      spy.mockRestore();
    }
    expect((await api.users.findOne({ username: 'rex' }))!.password).toBe(
      newer,
    );
  });
  it('rejects bad credentials uniformly', async () => {
    for (const body of [
      { username: 'alice', password: 'wrong password' },
      { username: 'nobody', password: 'whatever pass' },
    ])
      await api
        .http()
        .post(LOGIN)
        .send(body)
        .expect(401)
        .expect(errorCode('invalid_credentials'));
  });
  it('takes as long for unknown users as for wrong passwords', async () => {
    const time = async (username: string) => {
      const started = performance.now();
      await api
        .http()
        .post(LOGIN)
        .send({ username, password: 'wrong password' });
      return performance.now() - started;
    };
    await createUser(api.users, {
      username: 'timer',
      email: 'timer@example.com',
    });
    await api.users.updateOne(
      { username: 'timer' },
      { password: await hashPassword('correct horse battery') },
    );
    const [known, unknown] = [await time('timer'), await time('ghost')];
    expect(unknown).toBeGreaterThan(known * 0.5);
  });
  it('explains banned and unactivated accounts only after a correct password', async () => {
    await api
      .http()
      .post(LOGIN)
      .send({ username: 'carol', password: 'wrong password' })
      .expect(401);
    await api
      .http()
      .post(LOGIN)
      .send({ username: 'carol', password: 'correct horse battery' })
      .expect(403, {
        error: {
          code: 'banned',
          message: 'This account has been banned. Reason: spam',
          banReason: 'spam',
        },
      });
    await api
      .http()
      .post(LOGIN)
      .send({ username: 'dave', password: 'correct horse battery' })
      .expect(403)
      .expect(errorCode('account_not_activated'));
  });
  it('hides user data until the second factor passes', async () => {
    const response = await api
      .http()
      .post(LOGIN)
      .send({ username: 'tina', password: 'correct horse battery' })
      .expect(200);
    expect(sessionOf(response)).toMatchObject({
      user: null,
      twoFactorRequired: true,
    });
    expect(sessionOf(response).csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(response.headers))
      .expect(200)
      .expect(({ body }) => expect(sessionOf({ body }).user).toBeNull());
  });
  it('logs out one session or all of them', async () => {
    const login = () =>
      api
        .http()
        .post(LOGIN)
        .send({ username: 'alice', password: 'correct horse battery' });
    const [first, second, third] = [
      await login(),
      await login(),
      await login(),
    ];
    await api
      .http()
      .post('/api/internal/auth/logout')
      .set('Cookie', cookieFrom(first.headers))
      .set('X-CSRF-Token', sessionOf(first).csrfToken!)
      .expect(204);
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(first.headers))
      .expect(401);
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(second.headers))
      .expect(200);
    await api
      .http()
      .post('/api/internal/auth/logout-all')
      .set('Cookie', cookieFrom(second.headers))
      .set('X-CSRF-Token', sessionOf(second).csrfToken!)
      .expect(204);
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(third.headers))
      .expect(401);
  });
  it('validates the request body', async () => {
    await api.http().post(LOGIN).send({ username: 'alice' }).expect(400);
    await api
      .http()
      .post(LOGIN)
      .send({ username: { $ne: null }, password: 'x' })
      .expect(400);
  });
  it('replaces the existing session when logging in again', async () => {
    const login = (cookie?: string) =>
      api
        .http()
        .post(LOGIN)
        .set('Cookie', cookie ?? '')
        .send({ username: 'alice', password: 'correct horse battery' })
        .expect(200);
    const first = await login();
    const second = await login(cookieFrom(first.headers));
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(first.headers))
      .expect(401);
    await api
      .http()
      .get(ME)
      .set('Cookie', cookieFrom(second.headers))
      .expect(200);
  });
  it('limits a concurrent burst of wrong guesses', async () => {
    const redis = api.app.get<Redis>(REDIS);
    await Promise.all(
      (await redis.keys('rate:*')).map((key) => redis.del(key)),
    );
    await createUser(api.users, {
      username: 'burst',
      email: 'burst@example.com',
    });
    const statuses = (
      await Promise.all(
        Array.from({ length: 15 }, () =>
          api
            .http()
            .post(LOGIN)
            .send({ username: 'burst', password: 'wrong password' }),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });
  it('rate-limits after 10 failures even with the right password', async () => {
    const redis = api.app.get<Redis>(REDIS);
    await Promise.all(
      (await redis.keys('rate:*')).map((key) => redis.del(key)),
    );
    await createUser(api.users, {
      username: 'rita',
      email: 'rita@example.com',
    });
    for (let attempt = 0; attempt < 10; attempt++)
      await api
        .http()
        .post(LOGIN)
        .send({ username: 'rita', password: 'wrong password' })
        .expect(401);
    await api
      .http()
      .post(LOGIN)
      .send({ username: 'rita', password: 'correct horse battery' })
      .expect(429)
      .expect(errorCode('rate_limited'));
    await api
      .http()
      .post(LOGIN)
      .send({
        username: '\uff52\uff49\uff54\uff41',
        password: 'correct horse battery',
      })
      .expect(429);
    await api.http().post(LOGIN).send({ username: 'rita' }).expect(400);
  });

  it('carries the personal appearance on the session user, null until it is set', async () => {
    const paula = await createUser(api.users, {
      username: 'paula',
      email: 'paula@example.com',
      appearance: { accent: 'sunset', glass: 60, glow: 40 },
    });
    const meOf = async (userId: string) =>
      sessionOf(
        await api
          .http()
          .get(ME)
          .set('Cookie', (await loginAs(api, userId)).cookie)
          .expect(200),
      );
    expect((await meOf(paula._id)).user?.appearance).toEqual({
      accent: 'sunset',
      glass: 60,
      glow: 40,
    });
    const alice = await api.users.findOne({ username: 'Alice' });
    expect((await meOf(alice!._id)).user?.appearance).toBeNull();
  });
});
