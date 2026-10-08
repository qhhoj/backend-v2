import { timecodeAt, totpCode } from '@libs/auth';
import { decrypt, encryptionKey } from '@libs/common';
import { REDIS } from '@libs/common';
import Redis from 'ioredis';
import {
  ApiTest,
  createUser,
  errorCode,
  setupApiTest,
  TEST_ENV,
} from './setup';

const AUTH = '/api/internal/auth';
const TOTP = `${AUTH}/2fa/totp`;
const PASSWORD = 'correct horse battery';
const ENROLL = { currentPassword: PASSWORD };
const cookieFrom = (headers: Record<string, unknown>) =>
  String((headers['set-cookie'] as string[])[0]).split(';')[0];

interface Body {
  data: {
    csrfToken: string;
    secret: string;
    otpauthUrl: string;
    scratchCodes: string[];
    twoFactorRequired: boolean;
    user: { username: string } | null;
  };
}
const dataOf = (response: { body: unknown }) => (response.body as Body).data;
const currentCode = (secret: string) => totpCode(secret, timecodeAt());

describe('totp endpoints', () => {
  let api: ApiTest;
  const login = async () => {
    const response = await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username: 'alice', password: PASSWORD })
      .expect(200);
    return {
      cookie: cookieFrom(response.headers),
      csrf: dataOf(response).csrfToken,
      twoFactorRequired: dataOf(response).twoFactorRequired,
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
  const stored = () => api.users.findOne({ username: 'alice' }).exec();
  const clearRateLimits = async () => {
    const redis = api.app.get<Redis>(REDIS);
    const keys = await redis.keys('rate:*');
    if (keys.length) await redis.del(...keys);
  };

  /** Enables TOTP through the API and returns the secret and scratch codes. */
  const enable = async () => {
    const session = await login();
    const { secret } = dataOf(
      await post(`${TOTP}/enroll`, session, ENROLL).expect(201),
    );
    const { scratchCodes } = dataOf(
      await post(`${TOTP}/confirm`, session, {
        code: currentCode(secret),
      }).expect(201),
    );
    return { secret, scratchCodes };
  };
  /** Makes the current code fresh again by moving the replay marker back. */
  const rewind = () =>
    api.users.updateOne(
      { username: 'alice' },
      { lastTotpTimecode: timecodeAt() - 2 },
    );

  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await api.users.deleteMany({});
    await createUser(api.users, {});
    await clearRateLimits();
  });

  it('enrolls, confirms with a first code and stores the secret encrypted', async () => {
    const session = await login();
    const enrolled = dataOf(
      await post(`${TOTP}/enroll`, session, ENROLL).expect(201),
    );
    expect(enrolled.otpauthUrl).toContain(`secret=${enrolled.secret}`);
    await post(`${TOTP}/confirm`, session, {
      code: currentCode(enrolled.secret),
    })
      .expect(201)
      .expect(({ body }) =>
        expect((body as Body).data.scratchCodes).toHaveLength(5),
      );
    const user = await stored();
    expect(user!.isTotpEnabled).toBe(true);
    expect(user!.totpKey).not.toBe(enrolled.secret);
    expect(
      decrypt(user!.totpKey!, encryptionKey(TEST_ENV.ENCRYPTION_KEY)),
    ).toBe(enrolled.secret);
    expect(user!.lastTotpTimecode).toBeGreaterThan(0);
    await post(`${TOTP}/enroll`, session, ENROLL)
      .expect(400)
      .expect(errorCode('invalid_code'));
  });

  it('refuses to enroll without the current password and stores no pending secret', async () => {
    const session = await login();
    await post(`${TOTP}/enroll`, session, {
      currentPassword: 'wrong wrong wrong',
    })
      .expect(400)
      .expect(errorCode('invalid_credentials'));
    const sessionId = session.cookie.split('=')[1];
    expect((await api.sessions.get(sessionId))!.pendingTotpSecret).toBeNull();
    await post(`${TOTP}/enroll`, session)
      .expect(400)
      .expect(errorCode('validation_failed'));
    expect((await api.sessions.get(sessionId))!.pendingTotpSecret).toBeNull();
  });

  it('shares the failure budget of enrolment with password change', async () => {
    const session = await login();
    for (let count = 0; count < 10; count++)
      await post(`${TOTP}/enroll`, session, {
        currentPassword: 'wrong wrong wrong',
      })
        .expect(400)
        .expect(errorCode('invalid_credentials'));
    await post(`${AUTH}/password/change`, session, {
      currentPassword: PASSWORD,
      newPassword: 'yet another passphrase',
    })
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('enrolling twice replaces the pending secret', async () => {
    const session = await login();
    const first = dataOf(
      await post(`${TOTP}/enroll`, session, ENROLL).expect(201),
    );
    const second = dataOf(
      await post(`${TOTP}/enroll`, session, ENROLL).expect(201),
    );
    expect(second.secret).not.toBe(first.secret);
    await post(`${TOTP}/confirm`, session, {
      code: currentCode(first.secret),
    })
      .expect(400)
      .expect(errorCode('invalid_code'));
    await post(`${TOTP}/confirm`, session, {
      code: currentCode(second.secret),
    }).expect(201);
  });

  it('keeps the pending secret after a wrong code and rejects confirm without enroll', async () => {
    const session = await login();
    await post(`${TOTP}/confirm`, session, { code: '123456' })
      .expect(400)
      .expect(errorCode('invalid_code'));
    const { secret } = dataOf(
      await post(`${TOTP}/enroll`, session, ENROLL).expect(201),
    );
    const wrong = currentCode(secret) === '000000' ? '000001' : '000000';
    await post(`${TOTP}/confirm`, session, { code: wrong })
      .expect(400)
      .expect(errorCode('invalid_code'));
    expect((await stored())!.isTotpEnabled).toBe(false);
    await post(`${TOTP}/confirm`, session, {
      code: currentCode(secret),
    }).expect(201);
  });

  it('enables TOTP once when two confirms race', async () => {
    const session = await login();
    const { secret } = dataOf(
      await post(`${TOTP}/enroll`, session, ENROLL).expect(201),
    );
    const statuses = (
      await Promise.all(
        [1, 2].map(() =>
          post(`${TOTP}/confirm`, session, { code: currentCode(secret) }),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(
      decrypt(
        (await stored())!.totpKey!,
        encryptionKey(TEST_ENV.ENCRYPTION_KEY),
      ),
    ).toBe(secret);
  });

  it('requires the second factor after login and completes it with a fresh code', async () => {
    const { secret } = await enable();
    const session = await login();
    expect(session.twoFactorRequired).toBe(true);
    await post(`${AUTH}/token/regenerate`, session)
      .expect(403)
      .expect(errorCode('two_factor_required'));
    await rewind();
    await post(`${TOTP}/verify`, session, { code: currentCode(secret) }).expect(
      204,
    );
    await api
      .http()
      .get(`${AUTH}/me`)
      .set('Cookie', session.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect((body as Body).data.twoFactorRequired).toBe(false);
        expect((body as Body).data.user!.username).toBe('alice');
      });
    expect((await stored())!.lastLogin).toBeInstanceOf(Date);
    await post(`${AUTH}/token/regenerate`, session).expect(201);
  });

  it('refuses a replayed TOTP code on a new login', async () => {
    const { secret } = await enable();
    await rewind();
    const first = await login();
    await post(`${TOTP}/verify`, first, { code: currentCode(secret) }).expect(
      204,
    );
    const second = await login();
    await post(`${TOTP}/verify`, second, { code: currentCode(secret) })
      .expect(400)
      .expect(errorCode('invalid_code'));
  });

  it('lets exactly one of two concurrent submits of one TOTP code succeed', async () => {
    const { secret } = await enable();
    await rewind();
    const sessions = [await login(), await login()];
    const code = currentCode(secret);
    const statuses = (
      await Promise.all(
        sessions.map((session) => post(`${TOTP}/verify`, session, { code })),
      )
    ).map((response) => response.status);
    expect(statuses.sort()).toEqual([204, 400]);
  });

  it('accepts a scratch code once, case-insensitively', async () => {
    const { scratchCodes } = await enable();
    const first = await login();
    await post(`${TOTP}/verify`, first, {
      code: scratchCodes[0].toLowerCase(),
    }).expect(204);
    const second = await login();
    await post(`${TOTP}/verify`, second, { code: scratchCodes[0] })
      .expect(400)
      .expect(errorCode('invalid_code'));
    await post(`${TOTP}/verify`, second, { code: scratchCodes[1] }).expect(204);
  });

  it('lets exactly one of two concurrent submits of one scratch code succeed', async () => {
    const { scratchCodes } = await enable();
    const sessions = [await login(), await login()];
    const statuses = (
      await Promise.all(
        sessions.map((session) =>
          post(`${TOTP}/verify`, session, { code: scratchCodes[0] }),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.sort()).toEqual([204, 400]);
    const remaining = JSON.parse(
      decrypt(
        (await stored())!.scratchCodes!,
        encryptionKey(TEST_ENV.ENCRYPTION_KEY),
      ),
    ) as string[];
    expect(remaining).toHaveLength(4);
  });

  it('rate limits wrong codes and reports 400 when TOTP is not enabled', async () => {
    await api.users.updateOne(
      { username: 'alice' },
      { isWebauthnEnabled: true },
    );
    await post(`${TOTP}/verify`, await login(), { code: '123456' })
      .expect(400)
      .expect(errorCode('totp_not_enabled'));
    await api.users.updateOne(
      { username: 'alice' },
      { isWebauthnEnabled: false },
    );
    await enable();
    const session = await login();
    for (let attempt = 0; attempt < 10; attempt++)
      await post(`${TOTP}/verify`, session, {
        code: 'ZZZZZZZZZZZZZZZZ',
      }).expect(400);
    await post(`${TOTP}/verify`, session, { code: 'ZZZZZZZZZZZZZZZZ' })
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('validates the code shape', async () => {
    const session = await login();
    await post(`${TOTP}/verify`, session, { code: '1' })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('disables TOTP with a scratch code', async () => {
    const { scratchCodes } = await enable();
    const session = await login();
    await post(`${TOTP}/verify`, session, { code: scratchCodes[0] }).expect(
      204,
    );
    await post(`${TOTP}/disable`, session, { code: scratchCodes[1] }).expect(
      204,
    );
    const user = await stored();
    expect(user).toMatchObject({
      isTotpEnabled: false,
      totpKey: null,
      scratchCodes: null,
    });
    expect((await login()).twoFactorRequired).toBe(false);
  });

  it('regenerates scratch codes, invalidating the old set', async () => {
    const { scratchCodes } = await enable();
    const session = await login();
    await post(`${TOTP}/verify`, session, { code: scratchCodes[0] }).expect(
      204,
    );
    const fresh = dataOf(
      await post(`${TOTP}/scratch-codes`, session, {
        code: scratchCodes[1],
      }).expect(201),
    ).scratchCodes;
    expect(fresh).toHaveLength(5);
    await post(`${TOTP}/disable`, session, { code: scratchCodes[2] })
      .expect(400)
      .expect(errorCode('invalid_code'));
    await post(`${TOTP}/disable`, session, { code: fresh[0] }).expect(204);
  });

  it('keeps every management endpoint behind the second factor and the pwned-password gate', async () => {
    await api.users.updateOne({ username: 'alice' }, { isTotpEnabled: true });
    const partial = await login();
    for (const path of ['enroll', 'confirm', 'disable', 'scratch-codes'])
      await post(`${TOTP}/${path}`, partial, { code: '123456' })
        .expect(403)
        .expect(errorCode('two_factor_required'));
    await api.users.updateOne({ username: 'alice' }, { isTotpEnabled: false });
    const session = await login();
    await api.sessions.update(session.cookie.split('=')[1], {
      passwordPwned: true,
    });
    for (const path of ['enroll', 'confirm', 'disable', 'scratch-codes'])
      await post(`${TOTP}/${path}`, session, { code: '123456' })
        .expect(403)
        .expect(errorCode('password_change_required'));
  });

  it('works for migrated users lacking the totp fields', async () => {
    await api.users.collection.updateOne(
      { username: 'alice' },
      { $unset: { lastTotpTimecode: '', isTotpEnabled: '' } },
    );
    const { secret } = await enable();
    await api.users.collection.updateOne(
      { username: 'alice' },
      { $unset: { lastTotpTimecode: '' } },
    );
    const session = await login();
    await post(`${TOTP}/verify`, session, { code: currentCode(secret) }).expect(
      204,
    );
    expect((await stored())!.lastTotpTimecode).toBeGreaterThan(0);
  });

  it('caps failed attempts per day as well', async () => {
    await enable();
    const session = await login();
    const user = await stored();
    const redis = api.app.get<Redis>(REDIS);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (attempt % 5 === 0)
        await redis.del(`rate:second-factor:user:${user!._id}`);
      await post(`${TOTP}/verify`, session, {
        code: 'ZZZZZZZZZZZZZZZZ',
      }).expect(400);
    }
    await redis.del(`rate:second-factor:user:${user!._id}`);
    await post(`${TOTP}/verify`, session, { code: 'ZZZZZZZZZZZZZZZZ' })
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('returns 204 on an already completed session without consuming a code', async () => {
    const { scratchCodes } = await enable();
    const session = await login();
    await post(`${TOTP}/verify`, session, { code: scratchCodes[0] }).expect(
      204,
    );
    await post(`${TOTP}/verify`, session, { code: scratchCodes[0] }).expect(
      204,
    );
    const remaining = JSON.parse(
      decrypt(
        (await stored())!.scratchCodes!,
        encryptionKey(TEST_ENV.ENCRYPTION_KEY),
      ),
    ) as string[];
    expect(remaining).toHaveLength(4);
  });

  it('needs a session', async () => {
    await api.http().post(`${TOTP}/enroll`).expect(401);
  });
});
