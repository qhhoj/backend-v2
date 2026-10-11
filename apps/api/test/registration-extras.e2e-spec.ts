import { getQueueToken } from '@nestjs/bullmq';
import { REDIS } from '@libs/common';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { createUserWith } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const AUTH = '/api/internal/auth';
const PASSWORD = 'a long enough passphrase 42';

describe('registration extras', () => {
  let api: ApiTest;
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
        password: PASSWORD,
        ...overrides,
      });
  const issues = (response: { body: unknown }) =>
    (
      response.body as {
        error: { issues: Array<{ field: string; code: string }> };
      }
    ).error.issues;

  beforeAll(async () => {
    api = await setupApiTest();
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
  afterAll(() => api.teardown());
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
