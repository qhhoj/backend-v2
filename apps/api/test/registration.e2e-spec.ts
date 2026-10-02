import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { MAILER, REDIS } from '@libs/common';
import { ActivationKey } from '@libs/database';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { ApiTest, createUser, errorCode, setupApiTest } from './setup';

const AUTH = '/api/internal/auth';
const PASSWORD = 'correct horse battery';
const activationKeyFrom = (text: string) =>
  /\/activate\/([0-9a-f]{64})/.exec(text)![1];

describe('registration', () => {
  let api: ApiTest;
  let activationKeys: Model<ActivationKey>;
  const register = (username: string, email: string, password = PASSWORD) =>
    api.http().post(`${AUTH}/register`).send({ username, email, password });
  const activate = (token: string) =>
    api.http().post(`${AUTH}/activate`).send({ token });

  beforeAll(async () => {
    api = await setupApiTest();
    activationKeys = api.app.get(getModelToken(ActivationKey.name));
    await createUser(api.users, {
      username: 'Taken',
      email: 'taken@example.com',
    });
  });
  afterAll(() => api.teardown());
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

  it('rejects expired and unknown activation keys without activating', async () => {
    await register('late', 'late@example.com').expect(204);
    const key = activationKeyFrom(api.mailer.sent.at(-1)!.text);
    await activationKeys.updateMany(
      {},
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await activate(key).expect(400).expect(errorCode('invalid_token'));
    await activate('f'.repeat(64))
      .expect(400)
      .expect(errorCode('invalid_token'));
    expect((await api.users.findOne({ username: 'late' }))!.isActive).toBe(
      false,
    );
  });

  it('does not activate banned users', async () => {
    await register('banned_one', 'banned@example.com').expect(204);
    const key = activationKeyFrom(api.mailer.sent.at(-1)!.text);
    await api.users.updateOne(
      { username: 'banned_one' },
      { banReason: 'spam' },
    );
    await activate(key).expect(400).expect(errorCode('invalid_token'));
    expect(
      (await api.users.findOne({ username: 'banned_one' }))!.isActive,
    ).toBe(false);
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
        .collation({ locale: 'en', strength: 2 }),
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

  it('rate-limits registrations per IP', async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      await register('Taken', 'x@example.com', 'p');
    await register('another', 'another@example.com').expect(429);
  });
});

describe('registration with a failing mailer', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [
        {
          provide: MAILER,
          useValue: { send: () => Promise.reject(new Error('smtp down')) },
        },
      ],
    });
  });
  afterAll(() => api.teardown());

  it('returns 503 and leaves no user or key behind', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await api
      .http()
      .post(`${AUTH}/register`)
      .send({
        username: 'ghost',
        email: 'ghost@example.com',
        password: PASSWORD,
      })
      .expect(503)
      .expect(errorCode('mail_unavailable'));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('smtp down'));
    logged.mockRestore();
    expect(await api.users.findOne({ username: 'ghost' })).toBeNull();
    expect(
      await api.app
        .get<Model<ActivationKey>>(getModelToken(ActivationKey.name))
        .countDocuments(),
    ).toBe(0);
  });
});
