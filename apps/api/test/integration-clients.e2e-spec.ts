import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { generateApiToken, sha256 } from '@libs/auth';
import { IntegrationClient } from '@libs/database';
import type { Model } from 'mongoose';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import {
  createUser,
  errorCode,
  sessionCookie,
  setupApiTest,
  TEST_ENV,
} from './setup';
import type { ApiTest } from './setup';

interface Client {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  allowedCidrs: string[];
  actsAs: { id: string; username: string };
  revokedAt: string | null;
  expiresAt: string | null;
  key?: string;
}

const URL = '/api/internal/integration-clients';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('integration client administration', () => {
  let api: ApiTest;
  let clients: Model<IntegrationClient>;
  let adminId: string;
  let admin: TestSession;
  let counter = 0;
  const body = (extra: Record<string, unknown> = {}) => ({
    name: `bridge ${(counter += 1)}`,
    scopes: ['contests:write', 'contests:read'],
    allowedCidrs: ['10.0.0.0/8'],
    actsAs: 'syncauthor',
    ...extra,
  });
  const post = (payload: object, session = admin) =>
    authed(api.http().post(URL), session).send(payload);

  beforeAll(async () => {
    api = await setupApiTest();
    clients = api.app.get(getModelToken(IntegrationClient.name));
    adminId = (
      await createUserWith(api, 'intadmin', {
        permissions: ['judge.manage_integration'],
      })
    )._id;
    admin = await loginAs(api, adminId);
    await createUserWith(api, 'syncauthor', {
      permissions: ['judge.add_contest', 'judge.create_private_contest'],
    });
    await createUserWith(api, 'weakauthor', {
      permissions: ['judge.add_contest'],
    });
    await createUserWith(api, 'sleeper', {
      permissions: ['judge.add_contest', 'judge.create_private_contest'],
      isActive: false,
    });
  });
  afterAll(() => api.teardown());

  it('creates a client, shows the key once and stores only its hash', async () => {
    const created = dataOf<Client>(await post(body()).expect(201));
    expect(created.key).toMatch(/^qhi_[A-Za-z0-9_-]{43}$/);
    expect(created.keyPrefix).toBe(created.key!.slice(0, 8));
    expect(created.actsAs.username).toBe('syncauthor');
    expect(created.expiresAt).toBeNull();
    const stored = await clients.findById(created.id).lean();
    expect(stored?.keyHash).toBe(sha256(created.key!));
    expect(JSON.stringify(stored)).not.toContain(created.key!);
    const listed = await authed(api.http().get(URL), admin).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.key!);
    const row = dataOf<Client[]>(listed).find(
      (client) => client.id === created.id,
    );
    expect(row).toMatchObject({
      name: created.name,
      scopes: ['contests:write', 'contests:read'],
    });
    expect(row?.key).toBeUndefined();
  });

  it('stores an expiry in the future and shows it', async () => {
    const expiresAt = new Date(Date.now() + DAY_MS);
    const created = dataOf<Client>(
      await post(body({ expiresAt: expiresAt.toISOString() })).expect(201),
    );
    expect(new Date(created.expiresAt!).getTime()).toBe(expiresAt.getTime());
    expect(
      (await clients.findById(created.id).lean())?.expiresAt?.getTime(),
    ).toBe(expiresAt.getTime());
  });

  it.each([
    ['an unknown acting user', { actsAs: 'nobody' }],
    ['an acting user without create_private_contest', { actsAs: 'weakauthor' }],
    ['an inactive acting user', { actsAs: 'sleeper' }],
    ['no CIDR', { allowedCidrs: [] }],
    ['a bad CIDR', { allowedCidrs: ['10.0.0.0'] }],
    ['an out-of-range prefix', { allowedCidrs: ['10.0.0.0/33'] }],
    ['no scope', { scopes: [] }],
    ['an unknown scope', { scopes: ['users:write'] }],
    ['an empty name', { name: '' }],
    ['an extra field', { isAdmin: true }],
    ['an expiry in the past', { expiresAt: '2020-01-01T00:00:00Z' }],
    ['a malformed expiry', { expiresAt: 'tomorrow' }],
  ])('refuses %s with 400 and creates nothing', async (_name, extra) => {
    const before = await clients.countDocuments({});
    await post(body(extra)).expect(400);
    expect(await clients.countDocuments({})).toBe(before);
  });

  it('is for holders of judge.manage_integration only', async () => {
    const plain = await loginAs(
      api,
      (await createUserWith(api, 'intplain'))._id,
    );
    await post(body(), plain).expect(403).expect(errorCode('forbidden'));
    await authed(api.http().get(URL), plain).expect(403);
    await api.http().post(URL).send(body()).expect(401);
  });

  it('refuses a user API token and an impersonated session: credentials are minted from a real browser session', async () => {
    const { token, hash } = generateApiToken(adminId, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: adminId }, { apiTokenHash: hash });
    for (const request of [
      api.http().post(URL).send(body()),
      api.http().get(URL),
      api.http().delete(`${URL}/${adminId}`),
    ])
      await request
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
        .expect(errorCode('forbidden'));
    const root = await createUser(api.users, {
      username: 'introot',
      email: 'introot@example.com',
      isSuperuser: true,
    });
    const { id, session } = await api.sessions.create({
      userId: adminId,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: root._id,
    });
    await api
      .http()
      .post(URL)
      .set('Cookie', sessionCookie(id))
      .set('X-CSRF-Token', session.csrf)
      .send(body())
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('revokes a client, idempotently, and an unknown id is 404', async () => {
    const created = dataOf<Client>(await post(body()).expect(201));
    await authed(api.http().delete(`${URL}/${created.id}`), admin).expect(204);
    const revoked = await clients.findById(created.id).lean();
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    await authed(api.http().delete(`${URL}/${created.id}`), admin).expect(204);
    expect((await clients.findById(created.id).lean())?.revokedAt).toEqual(
      revoked?.revokedAt,
    );
    await authed(
      api.http().delete(`${URL}/0190a000-0000-7000-8000-000000000999`),
      admin,
    ).expect(404);
    await authed(api.http().delete(`${URL}/not-an-id`), admin).expect(404);
    const listed = dataOf<Client[]>(
      await authed(api.http().get(URL), admin).expect(200),
    );
    expect(
      listed.find((client) => client.id === created.id)?.revokedAt,
    ).not.toBeNull();
  });

  it('logs who created and revoked a client, never the key', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    const created = dataOf<Client>(await post(body()).expect(201));
    await authed(api.http().delete(`${URL}/${created.id}`), admin).expect(204);
    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('integration-client.'));
    log.mockRestore();
    expect(
      lines.map((line) => (JSON.parse(line) as { event: string }).event),
    ).toEqual(['integration-client.created', 'integration-client.revoked']);
    for (const line of lines) {
      expect(line).toContain(adminId);
      expect(line).toContain(created.id);
      expect(line).not.toContain(created.key!);
    }
  });
});
