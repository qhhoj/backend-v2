import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { generateApiToken, generateServiceKey } from '@libs/auth';
import { IntegrationClient, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';
import { SyncContestOwnership } from '../src/modules/sync/contests/sync-contest-ownership.service';
import { SyncActsAsService } from '../src/modules/sync/contests/sync-acts-as.service';
import {
  clearRateLimits,
  createContest,
  hoursFromNow,
} from './contest-fixtures';
import { createProblem, createUserWith, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest, TEST_ENV } from './setup';
import type { ApiTest } from './setup';

interface Upsert {
  key: string;
  action: string;
  dryRun: boolean;
  isVisible: boolean;
  participantCount: number;
}

describe('sync API: writing contests', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let clients: Model<IntegrationClient>;
  let counter = 0;
  const LOCAL = ['127.0.0.0/8', '::1/128'];
  const makeClient = async (extra: Partial<IntegrationClient> = {}) => {
    counter += 1;
    const actsAs = await createUserWith(api, `syncact${counter}`, {
      permissions: ['judge.add_contest', 'judge.create_private_contest'],
    });
    const { key, hash } = generateServiceKey();
    const client = await clients.create({
      name: `client${counter}`,
      keyHash: hash,
      keyPrefix: key.slice(0, 8),
      scopes: ['contests:write', 'contests:read'],
      allowedCidrs: LOCAL,
      actsAs: actsAs._id,
      createdBy: actsAs._id,
      ...extra,
    });
    return { client, actsAs, bearer: `Bearer ${key}` };
  };
  const newKey = () => `sync_${(counter += 1)}`;
  const payload = (extra: Record<string, unknown> = {}) => ({
    name: 'Round',
    startTime: hoursFromNow(24).toISOString(),
    endTime: hoursFromNow(27).toISOString(),
    problems: [
      { code: 'syncp1', points: 100 },
      { code: 'syncp2', points: 200 },
    ],
    ...extra,
  });
  const put = (bearer: string, key: string, body: object, query = '') =>
    api
      .http()
      .put(`/api/sync/v1/contests/${key}${query}`)
      .set('Authorization', bearer)
      .send(body);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    clients = api.app.get(getModelToken(IntegrationClient.name));
    await createProblem(api, catalog, { code: 'syncp1' });
    await createProblem(api, catalog, { code: 'syncp2' });
    await createProblem(api, catalog, { code: 'syncpriv', isPublic: false });
  });
  beforeEach(() => clearRateLimits(api));
  afterAll(() => api.teardown());

  it('creates a hidden private contest authored by the acting user, owned by the client', async () => {
    const { client, actsAs, bearer } = await makeClient();
    const key = newKey();
    const result = dataOf<Upsert>(
      await put(bearer, key, payload()).expect(200),
    );
    expect(result).toMatchObject({
      key,
      action: 'created',
      dryRun: false,
      isVisible: false,
      participantCount: 0,
    });
    const stored = await api.contests.findOne({ key }).lean();
    expect(stored).toMatchObject({
      isVisible: false,
      isPrivate: true,
      isOrganizationPrivate: false,
    });
    expect(uuidStr(stored!.managedBy!)).toBe(uuidStr(client._id));
    expect(stored!.authors.map(uuidStr)).toEqual([actsAs._id]);
    expect(stored!.organizations).toEqual([]);
    expect(
      stored!.problems.map((entry) => [entry.points, entry.order]),
    ).toEqual([
      [100, 0],
      [200, 1],
    ]);
  });

  it('reads back a contest it owns', async () => {
    const { bearer } = await makeClient();
    const key = newKey();
    await put(bearer, key, payload({ name: 'Readable' })).expect(200);
    const read = await api
      .http()
      .get(`/api/sync/v1/contests/${key}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(dataOf(read)).toMatchObject({
      key,
      name: 'Readable',
      isVisible: false,
      participantCount: 0,
    });
  });

  it('is idempotent: the same request again is "unchanged", a changed one "updated"', async () => {
    const { bearer } = await makeClient();
    const key = newKey();
    const body = payload({ formatName: 'icpc', formatConfig: {} });
    await put(bearer, key, body).expect(200);
    expect(
      dataOf<Upsert>(await put(bearer, key, body).expect(200)).action,
    ).toBe('unchanged');
    expect(
      dataOf<Upsert>(
        await put(bearer, key, { ...body, name: 'Renamed' }).expect(200),
      ).action,
    ).toBe('updated');
    expect(await api.contests.countDocuments({ key })).toBe(1);
    expect((await api.contests.findOne({ key }).lean())?.name).toBe('Renamed');
  });

  it('answers 409 conflict with an issue when a parallel create of the same key wins', async () => {
    const { bearer } = await makeClient();
    const key = newKey();
    await put(bearer, key, payload()).expect(200);
    const ownership = api.app.get(SyncContestOwnership);
    const stale = jest.spyOn(ownership, 'find').mockResolvedValueOnce(null);
    const response = await put(bearer, key, payload({ name: 'Twin' })).expect(
      409,
    );
    stale.mockRestore();
    const { error } = response.body as { error: Record<string, unknown> };
    expect(error).toMatchObject({
      code: 'conflict',
      issues: [{ field: 'key', code: 'key_taken' }],
    });
    expect(await api.contests.countDocuments({ key })).toBe(1);
  });

  it('answers 409 and writes nothing when the contest is published between the check and the write', async () => {
    const { bearer } = await makeClient();
    const key = newKey();
    await put(bearer, key, payload()).expect(200);
    const actsAs = api.app.get(SyncActsAsService);
    const original = actsAs.principalOf.bind(actsAs);
    const racing = jest
      .spyOn(actsAs, 'principalOf')
      .mockImplementationOnce(async (client) => {
        await api.contests.updateOne({ key }, { $set: { isVisible: true } });
        return original(client);
      });
    await put(bearer, key, payload({ name: 'Late' }))
      .expect(409)
      .expect(errorCode('conflict'));
    racing.mockRestore();
    expect((await api.contests.findOne({ key }).lean())?.name).toBe('Round');
  });

  it('validates without writing on a dry run, and still rejects a bad body', async () => {
    const { bearer } = await makeClient();
    const key = newKey();
    const result = dataOf<Upsert>(
      await put(bearer, key, payload(), '?dryRun=true').expect(200),
    );
    expect(result).toMatchObject({ action: 'created', dryRun: true });
    expect(await api.contests.countDocuments({ key })).toBe(0);
    await put(
      bearer,
      key,
      payload({ endTime: hoursFromNow(1).toISOString() }),
      '?dryRun=true',
    ).expect(400);
    await put(bearer, key, payload(), '?dryRun=maybe').expect(400);
  });

  it.each([
    ['isVisible', { isVisible: true }],
    ['isPrivate', { isPrivate: false }],
    [
      'organizations',
      { organizations: ['0190a000-0000-7000-8000-000000000001'] },
    ],
    ['authors', { authors: ['0190a000-0000-7000-8000-000000000001'] }],
    ['privateContestants', { privateContestants: [] }],
    ['accessCode', { accessCode: 'letmein' }],
    ['isRated', { isRated: true }],
    ['managedBy', { managedBy: null }],
  ])('has no way to set %s: the field is refused', async (_name, extra) => {
    const { bearer } = await makeClient();
    const key = newKey();
    await put(bearer, key, payload(extra))
      .expect(400)
      .expect(errorCode('validation_failed'));
    expect(await api.contests.countDocuments({ key })).toBe(0);
  });

  it("answers 403 for a contest it does not own, the same for a person's and another client's, and still creates new keys", async () => {
    const mine = await makeClient();
    const theirs = await makeClient();
    const human = await createContest(api, { key: newKey() });
    const others = newKey();
    await put(theirs.bearer, others, payload()).expect(200);
    const humanAnswer = await put(mine.bearer, human.key, payload())
      .expect(403)
      .expect(errorCode('forbidden'));
    const otherAnswer = await put(mine.bearer, others, payload()).expect(403);
    expect(humanAnswer.body).toEqual(otherAnswer.body);
    expect((await api.contests.findOne({ key: human.key }).lean())?.name).toBe(
      'Contest',
    );
    expect(
      (await api.contests.findOne({ key: others }).lean())?.managedBy,
    ).toEqual((await clients.findOne({ _id: theirs.client._id }).lean())?._id);
    await put(mine.bearer, newKey(), payload()).expect(200);
  });

  it("answers 404 with one identical body for a missing key, a person's contest and another client's", async () => {
    const mine = await makeClient();
    const theirs = await makeClient();
    const human = await createContest(api, { key: newKey() });
    const others = newKey();
    await put(theirs.bearer, others, payload()).expect(200);
    const read = (key: string) =>
      api
        .http()
        .get(`/api/sync/v1/contests/${key}`)
        .set('Authorization', mine.bearer)
        .expect(404);
    const missing = await read(newKey()).expect(errorCode('not_found'));
    expect((await read(human.key)).body).toEqual(missing.body);
    expect((await read(others)).body).toEqual(missing.body);
  });

  it('freezes everything but participants once a person published the contest or it started', async () => {
    const { bearer } = await makeClient();
    const published = newKey();
    const body = payload();
    await put(bearer, published, body).expect(200);
    await api.contests.updateOne(
      { key: published },
      { $set: { isVisible: true } },
    );
    await put(bearer, published, { ...body, name: 'Sneaky' })
      .expect(409)
      .expect(errorCode('contest_frozen'));
    expect(
      dataOf<Upsert>(await put(bearer, published, body).expect(200)).action,
    ).toBe('unchanged');
    const started = newKey();
    const startTime = hoursFromNow(-1).toISOString();
    await put(
      bearer,
      started,
      payload({ startTime, endTime: hoursFromNow(2).toISOString() }),
    ).expect(200);
    await put(
      bearer,
      started,
      payload({ startTime, endTime: hoursFromNow(5).toISOString() }),
    )
      .expect(409)
      .expect(errorCode('contest_frozen'));
    expect((await api.contests.findOne({ key: published }).lean())?.name).toBe(
      'Round',
    );
  });

  it('lets the client attach only problems its acting user can see, and does not tell hidden from missing', async () => {
    const { bearer, actsAs } = await makeClient();
    const key = newKey();
    const hidden = await put(
      bearer,
      key,
      payload({ problems: [{ code: 'syncpriv', points: 10 }] }),
    ).expect(400);
    const missing = await put(
      bearer,
      key,
      payload({ problems: [{ code: 'nosuchproblem', points: 10 }] }),
    ).expect(400);
    // One answer for both, so a client cannot probe for hidden problem codes.
    expect(hidden.body).toEqual(missing.body);
    expect(await api.contests.countDocuments({ key })).toBe(0);
    await api.users.updateOne(
      { _id: actsAs._id },
      { $addToSet: { permissions: 'judge.see_private_problem' } },
    );
    await put(
      bearer,
      key,
      payload({ problems: [{ code: 'syncpriv', points: 10 }] }),
    ).expect(200);
  });

  it.each([
    ['loses a permission', { permissions: ['judge.add_contest'] }],
    ['becomes a superuser', { isSuperuser: true }],
    ['is deactivated', { isActive: false }],
  ])(
    'refuses every sync route at once when the acting user %s',
    async (_name, change) => {
      const { bearer, actsAs } = await makeClient();
      const key = newKey();
      const body = payload();
      await put(bearer, key, body).expect(200);
      await api.users.updateOne({ _id: actsAs._id }, { $set: change });
      const route = (path: string) => `/api/sync/v1/contests/${path}`;
      const calls = [
        put(bearer, key, { ...body, name: 'Changed' }),
        put(bearer, newKey(), payload()),
        api.http().get(route(key)),
        api.http().get(route(`${key}/standings`)),
        api
          .http()
          .put(route(`${key}/participants`))
          .send({ usernames: [] }),
        api.http().delete(route(key)),
      ];
      for (const call of calls)
        await call
          .set('Authorization', bearer)
          .expect(403)
          .expect(errorCode('forbidden'));
      expect(await api.contests.findOne({ key }).lean()).toMatchObject({
        name: 'Round',
      });
    },
  );

  it('checks scope, user credentials and keys', async () => {
    const readOnly = await makeClient({ scopes: ['contests:read'] });
    await put(readOnly.bearer, newKey(), payload()).expect(403);
    const { token, hash } = generateApiToken(
      readOnly.actsAs._id,
      TEST_ENV.TOKEN_SECRET,
    );
    await api.users.updateOne(
      { _id: readOnly.actsAs._id },
      { apiTokenHash: hash },
    );
    await put(`Bearer ${token}`, newKey(), payload()).expect(403);
    await put(`Bearer ${generateServiceKey().key}`, newKey(), payload()).expect(
      401,
    );
    await api
      .http()
      .put(`/api/sync/v1/contests/${newKey()}`)
      .send(payload())
      .expect(401);
  });

  it('refuses a malformed or reserved key', async () => {
    const { bearer } = await makeClient();
    await put(bearer, 'current', payload()).expect(400);
    await put(bearer, 'Bad-Key', payload()).expect(400);
    expect(await api.contests.countDocuments({ key: 'current' })).toBe(0);
  });

  it('allows 60 requests a minute per client', async () => {
    const { bearer } = await makeClient();
    const key = newKey();
    for (let index = 0; index < 60; index += 1)
      await put(bearer, key, payload(), '?dryRun=true').expect(200);
    await put(bearer, key, payload(), '?dryRun=true')
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('logs each write with the client id', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    const { client, bearer } = await makeClient();
    await put(bearer, newKey(), payload()).expect(200);
    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('sync.contest'));
    log.mockRestore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: 'sync.contest.created',
      client: uuidStr(client._id),
    });
  });
});
