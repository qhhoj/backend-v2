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
});
