import { UsersRepository, hashPassword } from '@libs/auth';
import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { ActivationKey, CI, uuidStr } from '@libs/database';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { createUser, errorCode, setupApiTest } from './setup';
import { getQueueToken } from '@nestjs/bullmq';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import type { Queue } from 'bullmq';
import { createUserWith } from './problem-fixtures';
import type { ApiTest } from './setup';

let api: ApiTest;
beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

const AUTH = '/api/internal/auth';
const PASSWORD = 'correct horse battery';
const activationKeyFrom = (text: string) =>
  /\/activate\/([0-9a-f]{64})/.exec(text)![1];

describe('registration', () => {
  let activationKeys: Model<ActivationKey>;
  const register = (username: string, email: string, password = PASSWORD) =>
    api.http().post(`${AUTH}/register`).send({ username, email, password });
  const activate = (token: string) =>
    api.http().post(`${AUTH}/activate`).send({ token });

  beforeAll(async () => {
    await api.reset();
    activationKeys = api.app.get(getModelToken(ActivationKey.name));
    await createUser(api.users, {
      username: 'Taken',
      email: 'taken@example.com',
    });
  });
  const resetRateLimits = async () => {
    const redis = api.app.get<Redis>(REDIS);
    await Promise.all(
      (await redis.keys('rate:*')).map((key) => redis.del(key)),
    );
  };
  beforeEach(resetRateLimits);

  it('registers an inactive user and mails an activation link that activates once', async () => {
    await register('newbie', 'Newbie@Example.com').expect(204);
    const user = (await api.users.findOne({ username: 'newbie' }))!;
    expect(user.isActive).toBe(false);
    expect(user.email).toBe('Newbie@Example.com');
    const mail = api.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({
      to: 'Newbie@Example.com',
      subject: 'Activate your QHHOJ account',
    });
    const key = activationKeyFrom(mail.text);
    await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username: 'newbie', password: PASSWORD })
      .expect(403)
      .expect(errorCode('account_not_activated'));
    await activate(key).expect(204);
    expect((await api.users.findOne({ username: 'newbie' }))!.siteTheme).toBe(
      'auto',
    );
    await activate(key).expect(400).expect(errorCode('invalid_token'));
    await api
      .http()
      .post(`${AUTH}/login`)
      .send({ username: 'newbie', password: PASSWORD })
      .expect(200);
  });

  it('rejects taken usernames and emails case-insensitively, bad usernames and weak passwords', async () => {
    const response = await register(
      'TAKEN',
      'TAKEN@example.com',
      'taken',
    ).expect(400);
    expect(
      (response.body as { error: { fields: unknown } }).error.fields,
    ).toMatchObject({
      username: ['Username is taken.'],
      email: ['Email is already registered.'],
      password: expect.arrayContaining([
        'Password must be at least 8 characters.',
      ]) as unknown,
    });
    for (const username of ['has space', 'dấu', 'x'.repeat(31)])
      await register(username, 'ok@example.com')
        .expect(400)
        .expect(errorCode('validation_failed'));
    for (const email of ['not-an-email', 'a b@example.com', 'ünï@example.com'])
      await register('valid_name', email)
        .expect(400)
        .expect(errorCode('validation_failed'));
  });

  it.each([
    ['email', 'email_taken'],
    ['username', 'username_taken'],
  ])('maps a lost %s race on insert to %s', async (field, code) => {
    jest.spyOn(api.app.get(UsersRepository), 'create').mockRejectedValueOnce(
      Object.assign(new Error('E11000'), {
        code: 11000,
        keyPattern: { [field]: 1 },
      }),
    );
    const response = await register('racer_x', 'racer_x@example.com').expect(
      400,
    );
    expect(
      (
        response.body as {
          error: { issues: Array<{ field: string; code: string }> };
        }
      ).error.issues,
    ).toEqual([expect.objectContaining({ field, code })]);
  });

  it('consumes an activation key exactly once under concurrency', async () => {
    await register('racer', 'racer@example.com').expect(204);
    const key = activationKeyFrom(api.mailer.sent.at(-1)!.text);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => activate(key)),
    );
    expect(responses.filter(({ status }) => status === 204)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 400)).toHaveLength(7);
  });

  it('serializes concurrent registrations for the same email', async () => {
    const responses = await Promise.all([
      register('twin_one', 'Twin@example.com'),
      register('twin_two', 'TWIN@example.com'),
    ]);
    expect(responses.filter(({ status }) => status === 204)).toHaveLength(1);
    expect(
      responses.filter(({ status }) => status === 409 || status === 400),
    ).toHaveLength(1);
    expect(
      await api.users
        .countDocuments({ email: 'twin@example.com' })
        .collation(CI),
    ).toBe(1);
  });

  it('reclaims stale pending accounts but not recent ones', async () => {
    const day = 86_400_000;
    await register('stale_one', 'stale@example.com').expect(204);
    await register('fresh_one', 'fresh@example.com').expect(204);
    const stale = (await api.users.findOne({ username: 'stale_one' }))!;
    await api.users.updateOne(
      { _id: stale._id },
      { dateJoined: new Date(Date.now() - 8 * day) },
    );
    await register('stale_one', 'other@example.com').expect(204);
    await register('different', 'STALE@example.com').expect(204);
    await resetRateLimits();
    await register('fresh_one', 'fresh2@example.com')
      .expect(400)
      .expect(errorCode('validation_failed'));
    await register('fresh_two', 'fresh@example.com')
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('reclaims a stale pending account that only collides on email, and deletes its keys', async () => {
    await register('stale_mail', 'stalemail@example.com').expect(204);
    const stale = (await api.users.findOne({ username: 'stale_mail' }))!;
    expect(await activationKeys.countDocuments({ userId: stale._id })).toBe(1);
    await api.users.updateOne(
      { _id: stale._id },
      { dateJoined: new Date(Date.now() - 8 * 86_400_000) },
    );
    await register('new_owner', 'StaleMail@example.com').expect(204);
    expect(await api.users.findOne({ username: 'stale_mail' })).toBeNull();
    expect(await activationKeys.countDocuments({ userId: stale._id })).toBe(0);
  });
});

const LONG_PASSWORD = 'a long enough passphrase 42';

describe('registration extras', () => {
  let privateOrg: string;
  let unlistedOrg: string;
  let queue: Queue<{ organizationId: string }>;
  const register = (overrides: object = {}) =>
    api
      .http()
      .post(`${AUTH}/register`)
      .send({
        username: 'newbie',
        email: 'newbie@example.com',
        password: LONG_PASSWORD,
        ...overrides,
      });
  const issues = (response: { body: unknown }) =>
    (
      response.body as {
        error: { issues: Array<{ field: string; code: string }> };
      }
    ).error.issues;

  beforeAll(async () => {
    await api.reset();
    queue = api.app.get(getQueueToken(ORGANIZATION_POINTS_QUEUE));
    await api.languages.create({
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
    });
    const base = { name: 'School', about: '', aboutHtml: '' };
    [, privateOrg, unlistedOrg] = (
      await api.organizations.create([
        {
          ...base,
          slug: 'open',
          shortName: 'OPEN',
          isOpen: true,
          isUnlisted: false,
        },
        {
          ...base,
          slug: 'closed',
          shortName: 'CLOSED',
          isOpen: false,
          isUnlisted: false,
        },
        {
          ...base,
          slug: 'hidden',
          shortName: 'HID',
          isOpen: true,
          isUnlisted: true,
        },
      ])
    ).map((organization) => organization._id);
  });
  beforeEach(async () => {
    await api.users.deleteMany({
      username: { $in: ['newbie', 'pending', 'stale'] },
    });
    await queue.drain();
    await api.app.get<Redis>(REDIS).flushdb();
    api.mailer.sent.length = 0;
  });

  describe('organization and language on register', () => {
    it('refuses an unknown language and a private, unlisted or unknown organization with codes', async () => {
      const bad = await register({
        languageId: '0199a000-0000-7000-8000-00000000dead',
      }).expect(400);
      expect(issues(bad)).toEqual([
        expect.objectContaining({
          field: 'languageId',
          code: 'language_unknown',
        }),
      ]);
      for (const organizationId of [
        privateOrg,
        unlistedOrg,
        '0199a000-0000-7000-8000-00000000beef',
      ])
        expect(issues(await register({ organizationId }).expect(400))).toEqual([
          expect.objectContaining({
            field: 'organizationId',
            code: 'organization_unavailable',
          }),
        ]);
      await register({ organizationId: 'not-a-uuid' }).expect(400);
      expect(await api.users.countDocuments({ username: 'newbie' })).toBe(0);
    });

    it('defaults the language to C++17 when none is chosen, and to none without an active C++17', async () => {
      const languageOf = async (overrides: Record<string, unknown> = {}) => {
        await api.users.deleteMany({ username: 'newbie' });
        await api.app.get<Redis>(REDIS).flushdb();
        await register(overrides).expect(204);
        const user = await api.users.findOne({ username: 'newbie' }).lean();
        return user?.languageId ? uuidStr(user.languageId) : null;
      };
      expect(await languageOf()).toBeNull();
      const cpp = await api.languages.create({
        key: 'CPP17',
        name: 'C++17',
        commonName: 'C++',
        ace: 'c_cpp',
        pygments: 'cpp',
        extension: 'cpp',
      });
      const python = uuidStr(
        (await api.languages.findOne({ key: 'PY3' }).lean())!._id,
      );
      expect(await languageOf()).toBe(cpp._id);
      await api.languages.updateOne({ _id: cpp._id }, { isActive: false });
      expect(await languageOf()).toBeNull();
      await api.languages.updateOne({ _id: cpp._id }, { isActive: true });
      expect(await languageOf({ languageId: python })).toBe(python);
    });
  });

  describe('POST activate/resend', () => {
    const resend = (email: string) =>
      api.http().post(`${AUTH}/activate/resend`).send({ email });

    const waitForMail = async (count: number) => {
      for (
        let attempt = 0;
        attempt < 100 && api.mailer.sent.length < count;
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
    };

    it('mails a fresh working link to a pending account and retires the old key', async () => {
      await register().expect(204);
      const oldKey = /activate\/(\w+)/.exec(api.mailer.sent[0].text)![1];
      await resend('newbie@example.com').expect(204);
      await waitForMail(2);
      const newKey = /activate\/(\w+)/.exec(api.mailer.sent[1].text)![1];
      expect(newKey).not.toBe(oldKey);
      await api
        .http()
        .post(`${AUTH}/activate`)
        .send({ token: oldKey })
        .expect(400)
        .expect(errorCode('invalid_token'));
      await api
        .http()
        .post(`${AUTH}/activate`)
        .send({ token: newKey })
        .expect(204);
    });

    it('answers 204 and sends nothing for unknown, active and banned emails', async () => {
      await createUserWith(api, 'newbie', { email: 'active@example.com' });
      await api.users.create({
        username: 'pending',
        email: 'banned@example.com',
        password: '!',
        isActive: false,
        banReason: 'spam',
      });
      for (const email of [
        'nobody@example.com',
        'active@example.com',
        'banned@example.com',
      ])
        await resend(email).expect(204);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(api.mailer.sent).toHaveLength(0);
    });
  });
});

const OLD_PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'purple monkey dishwasher';
const tokenFrom = (text: string) =>
  /\/reset-password\/([A-Za-z0-9_-]+)/.exec(text)![1];

describe('password reset', () => {
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
    await api.reset();
  });
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
