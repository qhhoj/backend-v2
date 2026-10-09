import Redis from 'ioredis';
import { sha256 } from '@libs/auth';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import {
  bridgeCommands,
  clearBridgeCommands,
  dataOf,
} from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const JUDGES = '/api/internal/judges';
/** Asserts the refusal's `error.issues[].code` list. */
const issueCodes =
  (...codes: string[]) =>
  ({ body }: { body: { error: { issues: Array<{ code: string }> } } }) =>
    expect(body.error.issues.map((issue) => issue.code)).toEqual(codes);

describe('/api/internal/judges', () => {
  let api: ApiTest;
  let admin: TestSession;
  let member: TestSession;
  const create = async (name: string) =>
    dataOf<{ judge: { name: string }; authKey: string }>(
      await authed(api.http().post(JUDGES), admin).send({ name }).expect(201),
    );
  const storedHash = async (name: string) =>
    (await api.judges.findOne({ name }).lean())?.authKeyHash;

  beforeAll(async () => {
    api = await setupApiTest();
    admin = await loginAs(
      api,
      (
        await createUserWith(api, 'admin', {
          permissions: ['judge.change_judge'],
        })
      )._id,
    );
    member = await loginAs(api, (await createUserWith(api, 'member'))._id);
  });
  beforeEach(() => clearBridgeCommands(api));
  afterAll(() => api.teardown());

  it('every judge route is for judge.change_judge holders only', async () => {
    await create('judge-guarded');
    const routes = [
      api.http().get(JUDGES),
      api.http().post(JUDGES).send({ name: 'judge-denied' }),
      api.http().patch(`${JUDGES}/judge-guarded`).send({ isBlocked: true }),
      api.http().post(`${JUDGES}/judge-guarded/key`),
      api.http().post(`${JUDGES}/judge-guarded/disconnect`).send({}),
    ];
    await api.http().get(JUDGES).expect(401);
    for (const route of routes)
      await authed(route, member).expect(403).expect(errorCode('forbidden'));
    expect(await storedHash('judge-denied')).toBeUndefined();
    expect(await api.judges.findOne({ name: 'judge-guarded' })).toMatchObject({
      isBlocked: false,
    });
    expect(await bridgeCommands(api)).toEqual([]);
  });

  it('creates a judge whose key is shown once and stored only as its hash', async () => {
    const { judge, authKey } = dataOf<{ judge: object; authKey: string }>(
      await authed(api.http().post(JUDGES), admin)
        .send({ name: 'judge-a', description: 'rack 1' })
        .expect(201),
    );
    expect(judge).toMatchObject({
      name: 'judge-a',
      description: 'rack 1',
      online: false,
      isBlocked: false,
      isDisabled: false,
      runtimes: [],
      slots: 0,
      busy: 0,
      build: '',
      features: [],
    });
    expect(authKey.length).toBeGreaterThanOrEqual(32);
    expect(await storedHash('judge-a')).toBe(sha256(authKey));
    const listed = JSON.stringify(
      (await authed(api.http().get(JUDGES), admin).expect(200)).body,
    );
    expect(listed).not.toContain(authKey);
    expect(listed).not.toContain((await storedHash('judge-a'))!);
  });

  it('refuses a taken name with 409 and a malformed one with 400', async () => {
    await create('judge-dup');
    await authed(api.http().post(JUDGES), admin)
      .send({ name: 'judge-dup' })
      .expect(409)
      .expect(errorCode('conflict'))
      .expect(issueCodes('name_taken'));
    for (const name of ['', 'has space', 'x'.repeat(51)])
      await authed(api.http().post(JUDGES), admin)
        .send({ name })
        .expect(400)
        .expect(errorCode('validation_failed'));
  });

  it('lists online state, ping, load, runtimes and slots, and what the judge reported in its Hello', async () => {
    await api.judges.create({
      name: 'judge-live',
      authKeyHash: sha256('k'),
      online: true,
      ping: 0.02,
      load: 0.4,
      slots: 4,
      busy: 1,
      build: 'qhhoj-judge 0.1.0',
      protocolMinor: 0,
      features: ['interactive'],
      runtimes: [
        { language: 'CPP17', name: 'g++', version: '11.4', priority: 0 },
      ],
    });
    const listed = dataOf<Array<{ name: string }>>(
      await authed(api.http().get(JUDGES), admin).expect(200),
    );
    expect(listed.find((judge) => judge.name === 'judge-live')).toMatchObject({
      online: true,
      ping: 0.02,
      load: 0.4,
      slots: 4,
      busy: 1,
      build: 'qhhoj-judge 0.1.0',
      protocolMinor: 0,
      features: ['interactive'],
      runtimes: [
        { language: 'CPP17', name: 'g++', version: '11.4', priority: 0 },
      ],
    });
    // created last, listed first: the list is ordered by name, not by insertion
    await create('judge-0');
    const ordered = dataOf<Array<{ name: string }>>(
      await authed(api.http().get(JUDGES), admin).expect(200),
    );
    expect(ordered.map((judge) => judge.name)).toEqual([
      'judge-0',
      'judge-a',
      'judge-dup',
      'judge-guarded',
      'judge-live',
    ]);
  });

  it('rotates the key, replacing the stored hash, and asks the bridge to drop the judge', async () => {
    const { authKey: oldKey } = await create('judge-rot');
    const { authKey } = dataOf<{ authKey: string }>(
      await authed(api.http().post(`${JUDGES}/judge-rot/key`), admin).expect(
        200,
      ),
    );
    expect(authKey).not.toBe(oldKey);
    expect(await storedHash('judge-rot')).toBe(sha256(authKey));
    expect(await bridgeCommands(api)).toEqual([
      { type: 'disconnect-judge', judgeName: 'judge-rot', force: true },
    ]);
  });

  it('still returns the new key and keeps the block when the bridge command cannot be published', async () => {
    await create('judge-redis-down');
    const down = jest
      .spyOn(Redis.prototype, 'xadd')
      .mockRejectedValue(new Error('redis gone'));
    try {
      const { authKey } = dataOf<{ authKey: string }>(
        await authed(
          api.http().post(`${JUDGES}/judge-redis-down/key`),
          admin,
        ).expect(200),
      );
      expect(await storedHash('judge-redis-down')).toBe(sha256(authKey));
      await authed(api.http().patch(`${JUDGES}/judge-redis-down`), admin)
        .send({ isBlocked: true })
        .expect(200);
      expect(
        await api.judges.findOne({ name: 'judge-redis-down' }),
      ).toMatchObject({ isBlocked: true });
      expect(down).toHaveBeenCalled();
    } finally {
      down.mockRestore();
    }
  });

  it('blocks (dropping the connection), disables and enables through the bridge', async () => {
    await create('judge-flags');
    const blocked = await authed(
      api.http().patch(`${JUDGES}/judge-flags`),
      admin,
    )
      .send({ isBlocked: true })
      .expect(200);
    expect(dataOf(blocked)).toMatchObject({
      isBlocked: true,
      isDisabled: false,
    });
    await authed(api.http().patch(`${JUDGES}/judge-flags`), admin)
      .send({ isDisabled: true, description: 'maintenance' })
      .expect(200);
    await authed(api.http().patch(`${JUDGES}/judge-flags`), admin)
      .send({ isDisabled: false })
      .expect(200);
    expect(
      await api.judges.findOne({ name: 'judge-flags' }).lean(),
    ).toMatchObject({
      isBlocked: true,
      isDisabled: false,
      description: 'maintenance',
    });
    expect(await bridgeCommands(api)).toEqual([
      { type: 'disconnect-judge', judgeName: 'judge-flags', force: true },
      { type: 'disable-judge', judgeName: 'judge-flags', isDisabled: true },
      { type: 'disable-judge', judgeName: 'judge-flags', isDisabled: false },
    ]);
  });

  it('asks the bridge to disconnect a judge, gracefully unless forced', async () => {
    await create('judge-bye');
    await authed(api.http().post(`${JUDGES}/judge-bye/disconnect`), admin)
      .send({})
      .expect(204);
    await authed(api.http().post(`${JUDGES}/judge-bye/disconnect`), admin)
      .send({ force: true })
      .expect(204);
    expect(await bridgeCommands(api)).toEqual([
      { type: 'disconnect-judge', judgeName: 'judge-bye', force: false },
      { type: 'disconnect-judge', judgeName: 'judge-bye', force: true },
    ]);
  });

  it('answers 404 for an unknown or malformed judge name and sends nothing', async () => {
    for (const name of ['ghost', 'not a name'])
      await authed(
        api.http().patch(`${JUDGES}/${encodeURIComponent(name)}`),
        admin,
      )
        .send({ isDisabled: true })
        .expect(404)
        .expect(errorCode('not_found'))
        .expect(issueCodes('judge_not_found'));
    await authed(api.http().post(`${JUDGES}/ghost/key`), admin)
      .expect(404)
      .expect(issueCodes('judge_not_found'));
    await authed(api.http().post(`${JUDGES}/ghost/disconnect`), admin)
      .send({})
      .expect(404);
    expect(await bridgeCommands(api)).toEqual([]);
  });

  it('refuses null on a judge edit', async () => {
    await create('judge-null');
    await authed(api.http().patch(`${JUDGES}/judge-null`), admin)
      .send({ isBlocked: null })
      .expect(400)
      .expect(errorCode('validation_failed'));
    expect(await api.judges.findOne({ name: 'judge-null' })).toMatchObject({
      isBlocked: false,
    });
  });
});
