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

  it('is for judge.change_judge holders only', async () => {
    await api.http().get(JUDGES).expect(401);
    await authed(api.http().get(JUDGES), member)
      .expect(403)
      .expect(errorCode('forbidden'));
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
      problemCount: 0,
      runtimes: [],
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
      .expect(errorCode('conflict'));
    for (const name of ['', 'has space', 'x'.repeat(51)])
      await authed(api.http().post(JUDGES), admin)
        .send({ name })
        .expect(400)
        .expect(errorCode('validation_failed'));
  });

  it('lists online state, ping, load, runtimes and how many problems each judge has', async () => {
    await api.judges.create({
      name: 'judge-live',
      authKeyHash: sha256('k'),
      online: true,
      ping: 0.02,
      load: 0.4,
      problems: ['sum', 'mul'],
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
      problemCount: 2,
      runtimes: [
        { language: 'CPP17', name: 'g++', version: '11.4', priority: 0 },
      ],
    });
    expect(listed.map((judge) => judge.name)).toEqual(
      [...listed.map((judge) => judge.name)].sort(),
    );
  });

  it('rotates the key, killing the old one and the open connection', async () => {
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
        .expect(404);
    await authed(api.http().post(`${JUDGES}/ghost/key`), admin).expect(404);
    await authed(api.http().post(`${JUDGES}/ghost/disconnect`), admin)
      .send({})
      .expect(404);
    expect(await bridgeCommands(api)).toEqual([]);
  });
});
