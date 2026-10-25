import { hashPassword, PASSWORD_ITERATIONS, UsersRepository } from '@libs/auth';

import { AppError, REDIS } from '@libs/common';

import { newId } from '@libs/database';

import Redis from 'ioredis';

import { loginAs } from './problem-fixtures';
import { ApiTest, createUser, errorCode, setupApiTest } from './setup';

import { AuthService } from '../src/modules/auth/core/auth.service';
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
      rating: 2350,
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
      username: 'erin',
      isActive: false,
      deactivatedAt: new Date(),
    });
    await createUser(api.users, {
      username: 'tina',
      email: 'tina@example.com',
      isTotpEnabled: true,
      totpKey: 'stored-key',
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
      user: { username: 'Alice', rating: 2350, permissions: [] },
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

  it('offers webauthn only with a stored key; a legacy flag alone neither blocks nor lists it', async () => {
    await createUser(api.users, {
      username: 'flagonly',
      email: 'flagonly@example.com',
      isWebauthnEnabled: true,
    });
    const flagOnly = await api
      .http()
      .post(LOGIN)
      .send({ username: 'flagonly', password: 'correct horse battery' })
      .expect(200);
    expect(sessionOf(flagOnly).twoFactorRequired).toBe(false);
    await createUser(api.users, {
      username: 'totpflag',
      email: 'totpflag@example.com',
      isTotpEnabled: true,
      totpKey: 'stored-key',
      isWebauthnEnabled: true,
    });
    const mixed = await api
      .http()
      .post(LOGIN)
      .send({ username: 'totpflag', password: 'correct horse battery' })
      .expect(200);
    expect(sessionOf(mixed).twoFactor?.methods).toEqual(['totp']);
  });

  // The rehash runs at the production cost: under the e2e override (1000 rounds) the fixtures' hashes are not weak.
  describe('at the production hash cost', () => {
    let override: string | undefined;
    beforeAll(() => {
      override = process.env.TEST_PASSWORD_ITERATIONS;
      delete process.env.TEST_PASSWORD_ITERATIONS;
    });
    afterAll(() => {
      process.env.TEST_PASSWORD_ITERATIONS = override;
    });

    it('upgrades weak password hashes on login', async () => {
      await createUser(api.users, {
        username: 'bob',
        email: 'bob@example.com',
      });
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
      await createUser(api.users, {
        username: 'rex',
        email: 'rex@example.com',
      });
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
    it('still signs in when the rehash is refused, spending one correct-password unit', async () => {
      const user = await createUser(api.users, {
        username: 'rhea',
        email: 'rhea@example.com',
      });
      const before = user.password;
      const spy = jest
        .spyOn(api.app.get(UsersRepository), 'updatePasswordIfUnchanged')
        .mockRejectedValueOnce(new AppError('rate_limited', 429));
      try {
        await api
          .http()
          .post(LOGIN)
          .send({ username: 'rhea', password: 'correct horse battery' })
          .expect(200);
      } finally {
        spy.mockRestore();
      }
      expect((await api.users.findOne({ username: 'rhea' }))!.password).toBe(
        before,
      );
      const redis = api.app.get<Redis>(REDIS);
      expect(await redis.get(`rate:password-success:user:${user._id}`)).toBe(
        '1',
      );
    });
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
          issues: [
            {
              field: '',
              code: 'banned',
              message: 'This account has been banned. Reason: spam',
            },
          ],
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
    await api
      .http()
      .post(LOGIN)
      .send({ username: 'erin', password: 'correct horse battery' })
      .expect(403)
      .expect(errorCode('account_disabled'));
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

  it('counts failures per account and address (an IPv6 /64 is one address), so another address still signs in', async () => {
    await createUser(api.users, {
      username: 'victor',
      email: 'victor@example.com',
    });
    const auth = api.app.get(AuthService);
    for (let attempt = 0; attempt < 10; attempt++)
      await expect(
        auth.login(
          'victor',
          'wrong password',
          `2001:db8:1:2::${attempt}`,
          null,
        ),
      ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      auth.login('victor', 'correct horse battery', '2001:db8:1:2::ff', null),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    const session = await auth.login(
      'victor',
      'correct horse battery',
      '2001:db8:1:3::1',
      null,
    );
    expect(session.user.username).toBe('victor');
  });

  it('caps failures per account across the /64s of one IPv6 /48, without locking the account from another network', async () => {
    await createUser(api.users, {
      username: 'wendy',
      email: 'wendy@example.com',
    });
    const auth = api.app.get(AuthService);
    const codes: string[] = [];
    for (let subnet = 0; subnet < 40; subnet++)
      codes.push(
        await auth
          .login('wendy', 'wrong password', `2001:db8:48:${subnet}::1`, null)
          .then(
            () => 'signed_in',
            (error: AppError) => error.code,
          ),
      );
    expect(codes.slice(0, 30)).toEqual(Array(30).fill('invalid_credentials'));
    expect(codes.slice(30)).toEqual(Array(10).fill('rate_limited'));
    const session = await auth.login(
      'wendy',
      'correct horse battery',
      '2001:db8:49:1::1',
      null,
    );
    expect(session.user.username).toBe('wendy');
  });

  it('locks only the mistyped username on a shared address, never the whole classroom', async () => {
    const auth = api.app.get(AuthService);
    const classroom = '192.0.2.10';
    const password = 'correct horse battery';
    const students = await Promise.all(
      Array.from({ length: 60 }, (_unused, index) =>
        createUser(api.users, {
          username: `student${index}`,
          email: `student${index}@example.com`,
        }),
      ),
    );
    const typeThenSignIn = async (username: string) => {
      for (let typo = 0; typo < 3; typo++)
        await expect(
          auth.login(username, 'wrong password', classroom, null),
        ).rejects.toMatchObject({ code: 'invalid_credentials' });
      return (await auth.login(username, password, classroom, null)).user;
    };
    const signedIn = await Promise.all(
      students.map(({ username }) => typeThenSignIn(username)),
    );
    expect(signedIn).toHaveLength(60);

    const typist = await createUser(api.users, {
      username: 'typist',
      email: 'typist@example.com',
    });
    const codes: string[] = [];
    for (let attempt = 0; attempt < 15; attempt++)
      codes.push(
        await auth.login('typist', 'wrong password', classroom, null).then(
          () => 'signed_in',
          (error: AppError) => error.code,
        ),
      );
    expect(codes).toEqual([
      ...Array<string>(10).fill('invalid_credentials'),
      ...Array<string>(5).fill('rate_limited'),
    ]);
    const redis = api.app.get<Redis>(REDIS);
    // refused attempts are not counted
    expect(
      await redis.get(`rate:login:user:${typist._id}:ip:${classroom}`),
    ).toBe('10');
    await expect(
      auth.login('typist', password, classroom, null),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    const classmate = await auth.login('student0', password, classroom, null);
    expect(classmate.user.username).toBe('student0');
  });

  it('meters correct passwords per account, shared by login and confirmation, even in a concurrent burst', async () => {
    const owner = await createUser(api.users, {
      username: 'looper',
      email: 'looper@example.com',
    });
    const auth = api.app.get(AuthService);
    const context = {
      principal: { userId: owner._id },
      user: owner,
    } as unknown as Parameters<AuthService['confirmPassword']>[0];
    const password = 'correct horse battery';
    // a wrong password gives its claim back
    await expect(
      auth.login('looper', 'wrong password', '198.51.100.200', null),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    const results = await Promise.allSettled([
      ...Array.from({ length: 15 }, (_unused, index) =>
        auth.login('looper', password, `198.51.100.${index}`, null),
      ),
      ...Array.from({ length: 15 }, () =>
        auth.confirmPassword(context, password),
      ),
    ]);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(results.length - refused.length).toBe(20);
    for (const result of refused)
      expect(result.reason).toMatchObject({ code: 'rate_limited' });
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
