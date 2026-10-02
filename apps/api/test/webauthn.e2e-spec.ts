import { generateApiToken, UsersRepository } from '@libs/auth';
import { REDIS } from '@libs/common';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import Redis from 'ioredis';
import { FakeAuthenticator } from './fake-authenticator';
import {
  ApiTest,
  createUser,
  errorCode,
  setupApiTest,
  TEST_ENV,
} from './setup';

const AUTH = '/api/internal/auth';
const WEBAUTHN = `${AUTH}/2fa/webauthn`;
const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:5173';

type Session = { cookie: string; csrf: string };
interface Body {
  data: {
    csrfToken: string;
    twoFactorRequired: boolean;
    user: { username: string } | null;
    id: string;
    name: string;
  };
}
const dataOf = (response: { body: unknown }) => (response.body as Body).data;
const cookieFrom = (headers: Record<string, unknown>) =>
  String((headers['set-cookie'] as string[])[0]).split(';')[0];

describe('webauthn endpoints', () => {
  let api: ApiTest;
  const login = async (): Promise<Session> => {
    const response = await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username: 'alice', password: 'correct horse battery' })
      .expect(200);
    return {
      cookie: cookieFrom(response.headers),
      csrf: dataOf(response).csrfToken,
    };
  };
  const post = (path: string, session: Session, body: object = {}) =>
    api
      .http()
      .post(`${WEBAUTHN}/${path}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body);
  const stored = () => api.users.findOne({ username: 'alice' }).exec();
  const clearRateLimits = async () => {
    const redis = api.app.get<Redis>(REDIS);
    const keys = await redis.keys('rate:*');
    if (keys.length) await redis.del(...keys);
  };
  const authenticator = (origin = ORIGIN) =>
    new FakeAuthenticator(RP_ID, origin);

  /** Registers `fake` through the API on a fresh logged-in session. */
  const register = async (fake: FakeAuthenticator, name = 'Key') => {
    const session = await login();
    const options = dataOf(
      await post('register/options', session).expect(201),
    ) as unknown as PublicKeyCredentialCreationOptionsJSON;
    const response = await post('register/verify', session, {
      name,
      response: fake.register(options.challenge),
    }).expect(201);
    return { session, options, credential: dataOf(response) };
  };
  const loginOptions = async (session: Session) =>
    dataOf(
      await post('login/options', session).expect(201),
    ) as unknown as PublicKeyCredentialRequestOptionsJSON;
  const failedAssertion = (
    session: Session,
    fake: FakeAuthenticator,
    challenge: string,
  ) =>
    post('login/verify', session, { response: fake.authenticate(challenge) })
      .expect(400)
      .expect(errorCode('webauthn_failed'));

  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await api.users.deleteMany({});
    await createUser(api.users, {});
    await clearRateLimits();
  });

  it('registers a credential, completes login with it and removes it', async () => {
    const fake = authenticator();
    const { options, session, credential } = await register(fake, 'Laptop');
    expect(options.rp).toEqual({ id: RP_ID, name: 'QHHOJ' });
    expect(credential.name).toBe('Laptop');
    const user = (await stored())!;
    expect(user.isWebauthnEnabled).toBe(true);
    expect(user.webauthnUserHandle).toHaveLength(32);
    expect(user.webauthnCredentials[0]).toMatchObject({
      _id: credential.id,
      name: 'Laptop',
      credId: fake.id,
      counter: 1,
    });

    // The consumed challenge cannot be replayed.
    await post('register/verify', session, {
      name: 'Again',
      response: fake.register(options.challenge),
    })
      .expect(400)
      .expect(errorCode('webauthn_failed'));

    const pending = await login();
    await post('register/options', pending)
      .expect(403)
      .expect(errorCode('two_factor_required'));
    const requestOptions = await loginOptions(pending);
    expect(requestOptions.allowCredentials).toEqual([
      { id: fake.id, type: 'public-key' },
    ]);
    await post('login/verify', pending, {
      response: fake.authenticate(requestOptions.challenge),
    }).expect(204);
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Cookie', pending.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect((body as Body).data.twoFactorRequired).toBe(false);
        expect((body as Body).data.user!.username).toBe('alice');
      });
    const after = (await stored())!;
    expect(after.webauthnCredentials[0].counter).toBeGreaterThan(1);
    expect(after.lastLogin).toBeInstanceOf(Date);

    // Already complete: 204 without verifying anything.
    await post('login/verify', pending, { response: { garbage: true } }).expect(
      204,
    );

    await api
      .http()
      .delete(`${WEBAUTHN}/credentials/${credential.id}`)
      .set('Cookie', pending.cookie)
      .set('X-CSRF-Token', pending.csrf)
      .expect(204);
    expect((await stored())!.isWebauthnEnabled).toBe(false);
    await api
      .http()
      .delete(`${WEBAUTHN}/credentials/${credential.id}`)
      .set('Cookie', pending.cookie)
      .set('X-CSRF-Token', pending.csrf)
      .expect(404)
      .expect(errorCode('not_found'));
    await api
      .http()
      .delete(`${WEBAUTHN}/credentials/not-a-uuid`)
      .set('Cookie', pending.cookie)
      .set('X-CSRF-Token', pending.csrf)
      .expect(404);
  });

  it('keeps the user handle stable and excludes existing credentials', async () => {
    const first = authenticator();
    await register(first);
    const handle = (await stored())!.webauthnUserHandle!.toString('hex');
    await api.users.updateOne(
      { username: 'alice' },
      { isWebauthnEnabled: false },
    );
    const fresh = await login();
    const options2 = dataOf(
      await post('register/options', fresh).expect(201),
    ) as unknown as PublicKeyCredentialCreationOptionsJSON;
    expect(options2.excludeCredentials).toEqual([
      { id: first.id, type: 'public-key' },
    ]);
    expect(Buffer.from(options2.user.id, 'base64url').toString('hex')).toBe(
      handle,
    );
  });

  it('persists the user handle once when handles race', async () => {
    const users = api.app.get(UsersRepository);
    const [user] = await api.users.find({ username: 'alice' }).exec();
    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        users.setWebauthnUserHandle(user._id, Buffer.alloc(32, index)),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rejects an unknown authenticator and a wrong origin', async () => {
    const fake = authenticator();
    await register(fake);
    const session = await login();
    const { challenge } = await loginOptions(session);
    await failedAssertion(session, authenticator(), challenge);
    // The challenge was consumed by the failed attempt.
    await failedAssertion(session, fake, challenge);
    const second = await loginOptions(session);
    await failedAssertion(session, fake, `${second.challenge}x`);
    const third = await loginOptions(session);
    // The genuine key, but the browser reports another origin.
    Object.assign(fake, { origin: 'https://evil.example' });
    await failedAssertion(session, fake, third.challenge);
    Object.assign(fake, { origin: ORIGIN });
    const last = await loginOptions(session);
    await post('login/verify', session, {
      response: fake.authenticate(last.challenge),
    }).expect(204);
  });

  it('refuses login/verify without a challenge and login/options without credentials', async () => {
    await post('login/options', await login())
      .expect(400)
      .expect(errorCode('webauthn_not_enabled'));
    const fake = authenticator();
    await register(fake);
    const session = await login();
    await failedAssertion(session, fake, 'AAAA');
  });

  it('refuses a non-increasing sign counter as a possible clone', async () => {
    const fake = authenticator();
    await register(fake);
    await api.users.updateOne(
      { username: 'alice' },
      { 'webauthnCredentials.0.counter': 10 },
    );
    for (const count of [5, 10]) {
      const session = await login();
      const { challenge } = await loginOptions(session);
      fake.setSignCount(count);
      await failedAssertion(session, fake, challenge);
    }
    expect((await stored())!.webauthnCredentials[0].counter).toBe(10);
    const session = await login();
    const { challenge } = await loginOptions(session);
    fake.setSignCount(11);
    await post('login/verify', session, {
      response: fake.authenticate(challenge),
    }).expect(204);
    expect((await stored())!.webauthnCredentials[0].counter).toBe(11);
  });

  it('only moves the stored counter forward', async () => {
    const fake = authenticator();
    await register(fake);
    const users = api.app.get(UsersRepository);
    const id = (await stored())!._id;
    expect(await users.updateWebauthnCounter(id, fake.id, 5)).toBe(true);
    expect(await users.updateWebauthnCounter(id, fake.id, 5)).toBe(false);
    expect(await users.updateWebauthnCounter(id, fake.id, 3)).toBe(false);
    expect((await stored())!.webauthnCredentials[0].counter).toBe(5);
  });

  it('answers malformed responses with 400, never 500', async () => {
    const fake = authenticator();
    await register(fake);
    const garbage: unknown[] = [
      {},
      { id: fake.id },
      { id: fake.id, response: 'text' },
      { id: fake.id, response: { clientDataJSON: '!!!' } },
      { id: 42, response: null },
      {
        id: fake.id,
        rawId: fake.id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: Buffer.from('not json').toString('base64url'),
          authenticatorData: 'AA',
          signature: 'AA',
        },
      },
      {
        id: fake.id,
        rawId: fake.id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: Buffer.from('{"challenge":1}').toString('base64url'),
          authenticatorData: '',
          signature: '',
        },
      },
    ];
    const session = await login();
    for (const response of garbage) {
      await loginOptions(session);
      await post('login/verify', session, { response })
        .expect(400)
        .expect(errorCode('webauthn_failed'));
    }
    await clearRateLimits();
    await api.users.updateOne(
      { username: 'alice' },
      { isWebauthnEnabled: false },
    );
    const registering = await login();
    for (const response of garbage) {
      await post('register/options', registering).expect(201);
      await post('register/verify', registering, { name: 'x', response })
        .expect(400)
        .expect(errorCode('webauthn_failed'));
    }
    await post('login/verify', session, { response: [] })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('shares the second-factor budget with TOTP and gives the attempt back on success', async () => {
    const fake = authenticator();
    await register(fake);
    const userId = (await stored())!._id;
    const redis = api.app.get<Redis>(REDIS);
    const session = await login();
    const { challenge } = await loginOptions(session);
    await post('login/verify', session, {
      response: fake.authenticate(challenge),
    }).expect(204);
    expect(Number(await redis.get(`rate:second-factor:user:${userId}`))).toBe(
      0,
    );
    expect(
      Number(await redis.get(`rate:second-factor:user:${userId}:day`)),
    ).toBe(0);

    const blocked = await login();
    await loginOptions(blocked);
    await redis.set(`rate:second-factor:user:${userId}`, '10', 'EX', 900);
    await post('login/verify', blocked, { response: { id: fake.id } })
      .expect(429)
      .expect(errorCode('rate_limited'));
    await redis.set(`rate:second-factor:user:${userId}`, '0', 'EX', 900);
    await redis.set(`rate:second-factor:user:${userId}:day`, '50', 'EX', 900);
    await post('login/verify', blocked, { response: { id: fake.id } })
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('keeps registration behind the second factor and off bearer tokens', async () => {
    const user = (await stored())!;
    const { token, hash } = generateApiToken(user._id, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ username: 'alice' }, { apiTokenHash: hash });
    await api
      .http()
      .post(`${WEBAUTHN}/register/options`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('refuses registering a credential another account already holds', async () => {
    const fake = authenticator();
    await register(fake);
    await createUser(api.users, { username: 'bob', email: 'bob@example.com' });
    const response = await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username: 'bob', password: 'correct horse battery' })
      .expect(200);
    const session = {
      cookie: cookieFrom(response.headers),
      csrf: dataOf(response).csrfToken,
    };
    const options = dataOf(
      await post('register/options', session).expect(201),
    ) as unknown as PublicKeyCredentialCreationOptionsJSON;
    await post('register/verify', session, {
      name: 'Clone',
      response: fake.register(options.challenge),
    })
      .expect(400)
      .expect(errorCode('webauthn_failed'));
  });
});
