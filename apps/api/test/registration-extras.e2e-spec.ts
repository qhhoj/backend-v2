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
  let languageId: string;
  let openOrg: string;
  let privateOrg: string;
  let unlistedOrg: string;
  let queue: Queue<{ organizationId: string }>;
  const queuedOrganizations = async () =>
    (await queue.getJobs(['waiting'])).map((job) => job.data.organizationId);
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
    languageId = (
      await api.languages.create({
        key: 'PY3',
        name: 'Python 3',
        commonName: 'Python',
        ace: 'python',
        pygments: 'python3',
        extension: 'py',
      })
    )._id;
    const base = { name: 'School', about: '', aboutHtml: '' };
    [openOrg, privateOrg, unlistedOrg] = (
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
    it('stores the default language and the school', async () => {
      await register({ languageId, organizationId: openOrg }).expect(204);
      const user = await api.users.findOne({ username: 'newbie' }).lean();
      expect(user?.languageId?.toString()).toBe(languageId);
      expect(user?.organizations.map(String)).toEqual([openOrg]);
      expect(await queuedOrganizations()).toEqual([openOrg]);
    });

    it('queues no points job without an organization', async () => {
      await register().expect(204);
      expect(await queuedOrganizations()).toEqual([]);
    });

    it('queues the points job of the organization a reclaimed abandoned signup belonged to', async () => {
      await api.users.create({
        username: 'stale',
        email: 's@example.com',
        password: '!',
        isActive: false,
        organizations: [openOrg],
        dateJoined: new Date(Date.now() - 8 * 86_400_000),
      });
      await register({ username: 'stale' }).expect(204);
      expect(await queuedOrganizations()).toEqual([openOrg]);
    });

    it('stays optional', async () => {
      await register().expect(204);
      const user = await api.users.findOne({ username: 'newbie' }).lean();
      expect(user?.languageId).toBeNull();
      expect(user?.organizations).toEqual([]);
    });

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

  describe('GET username-available', () => {
    const check = (username: string) =>
      api.http().get(`${AUTH}/username-available`).query({ username });
    const available = (response: { body: unknown }) =>
      (response.body as { data: { available: boolean } }).data.available;

    it('says whether a name is free, case-insensitively', async () => {
      await createUserWith(api, 'Taken');
      expect(available(await check('taken').expect(200))).toBe(false);
      expect(available(await check('free_name').expect(200))).toBe(true);
    });

    it('treats an abandoned signup as free and a fresh one as taken', async () => {
      await api.users.create({
        username: 'pending',
        email: 'p@example.com',
        password: '!',
        isActive: false,
      });
      expect(available(await check('pending').expect(200))).toBe(false);
      await api.users.create({
        username: 'stale',
        email: 's@example.com',
        password: '!',
        isActive: false,
        dateJoined: new Date(Date.now() - 8 * 86_400_000),
      });
      expect(available(await check('stale').expect(200))).toBe(true);
    });

    it('validates the name like registration does and is rate limited per IP', async () => {
      await check('bad name')
        .expect(400)
        .expect(errorCode('validation_failed'));
      for (let attempt = 0; attempt < 30; attempt++)
        await check('some_name').expect(200);
      await check('some_name').expect(429).expect(errorCode('rate_limited'));
    });
  });

  describe('POST activate/resend', () => {
    const resend = (email: string) =>
      api.http().post(`${AUTH}/activate/resend`).send({ email });

    it('answers 503 mail_unavailable while mail is not configured', async () => {
      Object.assign(api.mailer, { isConfigured: () => false });
      try {
        await resend('newbie@example.com')
          .expect(503)
          .expect(errorCode('mail_unavailable'));
      } finally {
        delete (api.mailer as { isConfigured?: unknown }).isConfigured;
      }
    });
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

    it('sends nothing to a signup abandoned past the reclaim cutoff', async () => {
      await api.users.create({
        username: 'stale',
        email: 's@example.com',
        password: '!',
        isActive: false,
        dateJoined: new Date(Date.now() - 8 * 86_400_000),
      });
      await resend('s@example.com').expect(204);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(api.mailer.sent).toHaveLength(0);
    });

    it('is rate limited per email', async () => {
      for (let attempt = 0; attempt < 3; attempt++)
        await resend('same@example.com').expect(204);
      await resend('same@example.com')
        .expect(429)
        .expect(errorCode('rate_limited'));
    });

    it('is rate limited per IP across different emails', async () => {
      for (let attempt = 0; attempt < 10; attempt++)
        await resend(`someone${attempt}@example.com`).expect(204);
      await resend('someone10@example.com')
        .expect(429)
        .expect(errorCode('rate_limited'));
    });
  });
});
