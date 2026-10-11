import { UsersRepository } from '@libs/auth';
import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { ActivationKey, CI } from '@libs/database';
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
