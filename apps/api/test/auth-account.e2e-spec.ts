import { UsersRepository } from '@libs/auth';
import { ApiTest, createUser, errorCode, setupApiTest } from './setup';

const AUTH = '/api/internal/auth';
const cookieFrom = (headers: Record<string, unknown>) =>
  String((headers['set-cookie'] as string[])[0]).split(';')[0];

interface Body {
  data: { csrfToken: string; token: string; passwordChangeRequired: boolean };
  error: { fields: Record<string, string[]> };
}
const bodyOf = (response: { body: unknown }) => response.body as Body;

describe('account endpoints', () => {
  let api: ApiTest;
  const login = async (
    password = 'correct horse battery',
    username = 'alice',
  ) => {
    const response = await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username, password })
      .expect(200);
    return {
      cookie: cookieFrom(response.headers),
      csrf: bodyOf(response).data.csrfToken,
    };
  };
  const post = (
    path: string,
    session: { cookie: string; csrf: string },
    body: object = {},
  ) =>
    api
      .http()
      .post(`${AUTH}/${path}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body);

  beforeAll(async () => {
    api = await setupApiTest();
    await createUser(api.users, {});
    await createUser(api.users, { username: 'bob', email: 'bob@example.com' });
    await createUser(api.users, {
      username: 'carol',
      email: 'carol@example.com',
    });
  });
  afterAll(() => api.teardown());

  it('changes the password, keeps this session and revokes the others', async () => {
    const [current, other] = [await login(), await login()];
    await post('password/change', current, {
      currentPassword: 'correct horse battery',
      newPassword: 'brand new passphrase',
    }).expect(204);
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Cookie', current.cookie)
      .expect(200);
    await api.http().get(`${AUTH}/me`).set('Cookie', other.cookie).expect(401);
    await login('brand new passphrase');
    await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username: 'alice', password: 'correct horse battery' })
      .expect(401);
  });

  it('rejects a wrong current password and weak new passwords with field errors', async () => {
    const session = await login('brand new passphrase');
    await post('password/change', session, {
      currentPassword: 'nope nope nope',
      newPassword: 'another good one',
    })
      .expect(400)
      .expect(errorCode('invalid_credentials'))
      .expect(({ body }) =>
        expect(bodyOf({ body }).error.fields).toHaveProperty('currentPassword'),
      );
    await post('password/change', session, {
      currentPassword: 'brand new passphrase',
      newPassword: 'alice123',
    })
      .expect(400)
      .expect(errorCode('validation_failed'))
      .expect(({ body }) =>
        expect(bodyOf({ body }).error.fields.newPassword).toEqual(
          expect.arrayContaining([
            'Password is too similar to your username or email.',
          ]),
        ),
      );
  });

  it('lets a pwned-flagged session change its password and then clears the flag', async () => {
    const session = await login('brand new passphrase');
    const sessionId = session.cookie.split('=')[1];
    await api.sessions.update(sessionId, { passwordPwned: true });
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Cookie', session.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(bodyOf({ body }).data.passwordChangeRequired).toBe(true),
      );
    await post('password/change', session, {
      currentPassword: 'brand new passphrase',
      newPassword: 'third passphrase here',
    }).expect(204);
    expect((await api.sessions.get(sessionId))!.passwordPwned).toBe(false);
  });

  const regenerate = (session: { cookie: string; csrf: string }) =>
    post('token/regenerate', session, {
      currentPassword: 'third passphrase here',
    });
  const bearerMe = (token: string) =>
    api.http().get(`${AUTH}/me`).set('Authorization', `Bearer ${token}`);

  it('issues an api token only against the current password', async () => {
    const session = await login('third passphrase here');
    await post('token/regenerate', session).expect(400);
    await post('token/regenerate', session, { currentPassword: 'wrong guess' })
      .expect(400)
      .expect(errorCode('invalid_credentials'));
    await bearerMe(
      bodyOf(await regenerate(session).expect(201)).data.token,
    ).expect(200);
  });

  it('revokes the api token on a password change and on signing out everywhere', async () => {
    const session = await login('third passphrase here');
    const beforeChange = bodyOf(await regenerate(session).expect(201)).data
      .token;
    await post('password/change', session, {
      currentPassword: 'third passphrase here',
      newPassword: 'fourth passphrase here',
    }).expect(204);
    await bearerMe(beforeChange).expect(401);
    await post('password/change', session, {
      currentPassword: 'fourth passphrase here',
      newPassword: 'third passphrase here',
    }).expect(204);
    const beforeLogoutAll = bodyOf(await regenerate(session).expect(201)).data
      .token;
    await post('logout-all', session).expect(204);
    await bearerMe(beforeLogoutAll).expect(401);
  });

  it('issues an api token once and replaces the old one on regeneration', async () => {
    const session = await login('third passphrase here');
    const first = bodyOf(await regenerate(session).expect(201)).data.token;
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${first}`)
      .expect(200);
    const second = bodyOf(await regenerate(session).expect(201)).data.token;
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${first}`)
      .expect(401);
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${second}`)
      .expect(200);
  });

  it('refuses bearer tokens on every account-management route', async () => {
    const session = await login('third passphrase here');
    const token = bodyOf(await regenerate(session).expect(201)).data.token;
    for (const path of ['password/change', 'token/regenerate', 'logout-all'])
      await api
        .http()
        .post(`${AUTH}/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'third passphrase here', newPassword: 'x' })
        .expect(403)
        .expect(errorCode('forbidden'));
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rejects reusing the current password', async () => {
    const session = await login('third passphrase here');
    await post('password/change', session, {
      currentPassword: 'third passphrase here',
      newPassword: 'third passphrase here',
    })
      .expect(400)
      .expect(errorCode('validation_failed'))
      .expect(({ body }) =>
        expect(bodyOf({ body }).error.fields.newPassword).toContain(
          'New password must differ from the current password.',
        ),
      );
  });

  it('answers 409 when the password changed concurrently', async () => {
    const session = await login('third passphrase here');
    const spy = jest
      .spyOn(api.app.get(UsersRepository), 'updatePasswordIfUnchanged')
      .mockResolvedValueOnce(false);
    try {
      await post('password/change', session, {
        currentPassword: 'third passphrase here',
        newPassword: 'a fresh passphrase 42',
      })
        .expect(409)
        .expect(errorCode('conflict'));
    } finally {
      spy.mockRestore();
    }
  });

  it('updatePasswordIfUnchanged only writes when the hash matches', async () => {
    const repository = api.app.get(UsersRepository);
    const user = (await repository.findByUsername('bob'))!;
    expect(
      await repository.updatePasswordIfUnchanged(user._id, 'stale', 'new'),
    ).toBe(false);
    expect(
      await repository.updatePasswordIfUnchanged(
        user._id,
        user.password,
        user.password,
      ),
    ).toBe(true);
  });

  it('rate-limits wrong current passwords and blocks the eleventh attempt', async () => {
    const session = await login('correct horse battery', 'bob');
    const attempt = (currentPassword: string) =>
      post('password/change', session, {
        currentPassword,
        newPassword: 'yet another passphrase',
      });
    for (let count = 0; count < 10; count++)
      await attempt('wrong wrong wrong')
        .expect(400)
        .expect(errorCode('invalid_credentials'));
    await attempt('correct horse battery')
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('releases the reservation after a correct current password', async () => {
    const session = await login('correct horse battery', 'carol');
    const attempt = (currentPassword: string) =>
      post('password/change', session, { currentPassword, newPassword: 'x' });
    for (let count = 0; count < 9; count++)
      await attempt('wrong wrong wrong')
        .expect(400)
        .expect(errorCode('invalid_credentials'));
    await attempt('correct horse battery')
      .expect(400)
      .expect(errorCode('validation_failed'));
    await attempt('wrong wrong wrong')
      .expect(400)
      .expect(errorCode('invalid_credentials'));
    await attempt('wrong wrong wrong').expect(429);
  });
});
