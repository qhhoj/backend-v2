import { Logger } from '@nestjs/common';
import { hashPassword } from '@libs/auth';
import { REDIS } from '@libs/common';
import Redis from 'ioredis';
import { ApiTest, createUser, errorCode, setupApiTest } from './setup';

const AUTH = '/api/internal/auth';
const OLD_PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'purple monkey dishwasher';
const tokenFrom = (text: string) =>
  /\/reset-password\/([A-Za-z0-9_-]+)/.exec(text)![1];

describe('password reset', () => {
  let api: ApiTest;
  const requestReset = (email: string) =>
    api.http().post(`${AUTH}/password/reset`).send({ email });
  const confirm = (token: string, newPassword = NEW_PASSWORD) =>
    api
      .http()
      .post(`${AUTH}/password/reset/confirm`)
      .send({ token, newPassword });
  const login = (username: string, password: string) =>
    api.http().post(`${AUTH}/login`).send({ username, password });
  /** Mail is sent in the background, so wait for it to land. */
  const mailCountAfterSettling = async (expected: number) => {
    for (
      let attempt = 0;
      attempt < 50 && api.mailer.sent.length < expected;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return api.mailer.sent.length;
  };

  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    const redis = api.app.get<Redis>(REDIS);
    await Promise.all(
      (await redis.keys('rate:*')).map((key) => redis.del(key)),
    );
    api.mailer.sent.length = 0;
  });

  it('mails a reset link for a known email and ignores unknown and inactive accounts', async () => {
    await createUser(api.users, {
      username: 'known',
      email: 'known@example.com',
    });
    await createUser(api.users, {
      username: 'sleeper',
      email: 'sleeper@example.com',
      isActive: false,
    });
    await requestReset('KNOWN@example.com').expect(204);
    expect(await mailCountAfterSettling(1)).toBe(1);
    expect(api.mailer.sent[0]).toMatchObject({
      to: 'known@example.com',
      subject: 'Reset your QHHOJ password',
    });
    api.mailer.sent.length = 0;
    for (const email of ['nobody@example.com', 'sleeper@example.com'])
      await requestReset(email).expect(204);
    expect(await mailCountAfterSettling(1)).toBe(0);
  });

  it('sets a first password for an unusable-hash account, once', async () => {
    await createUser(api.users, {
      username: 'social',
      email: 'social@example.com',
    });
    await api.users.updateOne(
      { username: 'social' },
      { $set: { password: '!unusable' } },
    );
    await requestReset('social@example.com').expect(204);
    expect(await mailCountAfterSettling(1)).toBe(1);
    const token = tokenFrom(api.mailer.sent[0].text);
    await confirm(token).expect(204);
    await confirm(token, 'another long passphrase 1')
      .expect(400)
      .expect(errorCode('invalid_token'));
    await login('social', OLD_PASSWORD).expect(401);
    const response = await login('social', NEW_PASSWORD).expect(200);
    const cookie = String(
      (response.headers['set-cookie'] as unknown as string[])[0],
    ).split(';')[0];
    const csrf = (response.body as { data: { csrfToken: string } }).data
      .csrfToken;
    await api
      .http()
      .post(`${AUTH}/2fa/totp/enroll`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: NEW_PASSWORD })
      .expect(201);
  });

  it('mails every active account sharing the email', async () => {
    await createUser(api.users, {
      username: 'twin1',
      email: 'twin@example.com',
    });
    await createUser(api.users, {
      username: 'twin2',
      email: 'Twin@example.com',
    });
    await requestReset('twin@example.com').expect(204);
    expect(await mailCountAfterSettling(2)).toBe(2);
    const tokens = api.mailer.sent.map((mail) => tokenFrom(mail.text));
    expect(new Set(tokens).size).toBe(2);
  });

  it('resets the password once, revokes sessions and switches the login', async () => {
    const user = await createUser(api.users, {
      username: 'resetme',
      email: 'resetme@example.com',
    });
    const { id: sessionId } = await api.sessions.create({
      userId: user._id,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: null,
    });
    await requestReset('resetme@example.com').expect(204);
    await mailCountAfterSettling(1);
    const token = tokenFrom(api.mailer.sent[0].text);
    await confirm(token).expect(204);
    expect(await api.sessions.get(sessionId)).toBeNull();
    await login('resetme', OLD_PASSWORD).expect(401);
    await login('resetme', NEW_PASSWORD).expect(200);
    await confirm(token, 'another long passphrase 1')
      .expect(400)
      .expect(errorCode('invalid_token'));
  });

  it('clears the API token hash on reset', async () => {
    await createUser(api.users, {
      username: 'tokened',
      email: 'tokened@example.com',
      apiTokenHash: 'a'.repeat(64),
    });
    await requestReset('tokened@example.com').expect(204);
    await mailCountAfterSettling(1);
    await confirm(tokenFrom(api.mailer.sent[0].text)).expect(204);
    expect(
      (await api.users.findOne({ username: 'tokened' }))!.apiTokenHash,
    ).toBeNull();
  });

  it('refuses a token for a user banned after it was issued', async () => {
    const user = await createUser(api.users, {
      username: 'later_banned',
      email: 'later@example.com',
    });
    await requestReset('later@example.com').expect(204);
    await mailCountAfterSettling(1);
    await api.users.updateOne(
      { _id: user._id },
      { isActive: false, banReason: 'spam' },
    );
    await confirm(tokenFrom(api.mailer.sent[0].text))
      .expect(400)
      .expect(errorCode('invalid_token'));
  });

  it('answers unknown emails in the same order of magnitude as known ones', async () => {
    await createUser(api.users, {
      username: 'timed',
      email: 'timed@example.com',
    });
    const time = async (email: string) => {
      const started = performance.now();
      await requestReset(email).expect(204);
      return performance.now() - started;
    };
    await time('warmup@example.com');
    let known = 0;
    let unknown = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      known += await time('timed@example.com');
      unknown += await time(`ghost${attempt}@example.com`);
    }
    expect(unknown).toBeLessThan(known * 5 + 20);
    expect(known).toBeLessThan(unknown * 5 + 20);
  });

  it('rejects a token after a login that followed the request', async () => {
    // Full-cost hash: a login must not rehash it, so only lastLogin can invalidate the token.
    await createUser(api.users, {
      username: 'loggedin',
      email: 'loggedin@example.com',
    });
    await api.users.updateOne(
      { username: 'loggedin' },
      { $set: { password: await hashPassword(OLD_PASSWORD) } },
    );
    const hashBefore = (await api.users.findOne({ username: 'loggedin' }))!
      .password;
    await requestReset('loggedin@example.com').expect(204);
    await mailCountAfterSettling(1);
    const token = tokenFrom(api.mailer.sent[0].text);
    await login('loggedin', OLD_PASSWORD).expect(200);
    const after = (await api.users.findOne({ username: 'loggedin' }))!;
    expect(after.password).toBe(hashBefore);
    expect(after.lastLogin).not.toBeNull();
    await confirm(token).expect(400).expect(errorCode('invalid_token'));
  });

  it('rejects malformed and forged tokens and weak passwords', async () => {
    await createUser(api.users, {
      username: 'weak',
      email: 'weak@example.com',
    });
    await requestReset('weak@example.com').expect(204);
    await mailCountAfterSettling(1);
    const token = tokenFrom(api.mailer.sent[0].text);
    const raw = Buffer.from(token, 'base64url');
    raw[raw.length - 1] ^= 0xff;
    const forged = raw.toString('base64url');
    for (const bad of ['x', 'A'.repeat(70), forged])
      await confirm(bad).expect(400).expect(errorCode('invalid_token'));
    const response = await confirm(token, 'weak').expect(400);
    expect(
      (
        response.body as {
          error: { code: string; fields: Record<string, unknown> };
        }
      ).error,
    ).toMatchObject({
      code: 'validation_failed',
      fields: { newPassword: expect.any(Array) as unknown },
    });
    await confirm(token).expect(204);
  });

  it('logs mail failures and still answers 204', async () => {
    await createUser(api.users, {
      username: 'mailfail',
      email: 'mailfail@example.com',
    });
    const send = jest
      .spyOn(api.mailer, 'send')
      .mockRejectedValue(new Error('smtp down'));
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await requestReset('mailfail@example.com').expect(204);
      for (
        let attempt = 0;
        attempt < 50 && !logged.mock.calls.length;
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('smtp down'));
    } finally {
      send.mockRestore();
      logged.mockRestore();
    }
  });

  it('answers 503 mail_unavailable, spending no budget, while mail is not configured', async () => {
    Object.assign(api.mailer, { isConfigured: () => false });
    try {
      for (let attempt = 0; attempt < 5; attempt++)
        await requestReset('nomail@example.com')
          .expect(503)
          .expect(errorCode('mail_unavailable'));
    } finally {
      delete (api.mailer as { isConfigured?: unknown }).isConfigured;
    }
    await requestReset('nomail@example.com').expect(204);
  });

  it('limits to 3 requests per email per hour', async () => {
    for (let attempt = 0; attempt < 3; attempt++)
      await requestReset('limited@example.com').expect(204);
    await requestReset('limited@example.com').expect(429);
  });
});
