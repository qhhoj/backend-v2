import { status } from '@grpc/grpc-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { sha256 } from '@libs/auth';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { JudgeError, Status } from '@libs/judge-proto';
import { BridgeCommandsService } from '@libs/judging';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
} from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const rawSocket = (port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => resolve(socket)).once('error', reject);
  });
const closedSoon = (socket: Socket) =>
  new Promise<boolean>((resolve) => {
    socket.once('close', () => resolve(true));
    setTimeout(() => resolve(false), 300);
  });
const judge = (name: string, extra = {}) => ({
  name,
  key: `${name}-key`,
  ...extra,
});

describe('Judge link (gRPC)', () => {
  let bridge: BridgeTest;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const row = async (name: string) => bridge.judges.findOne({ name }).lean();
  beforeAll(async () => {
    bridge = await setupBridgeTest();
    for (const name of ['j1', 'j2'])
      await seedJudge(bridge, name, `${name}-key`);
    await seedJudge(bridge, 'blocked', 'blocked-key', { isBlocked: true });
  });
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  it('marks a judge online with what its Hello reports, records its pongs, and marks it offline when it leaves', async () => {
    const fake = await FakeJudge.online(
      bridge.judgePort(),
      judge('j1', { slots: 3, languages: ['CPP17'] }),
    );
    await waitUntil(async () => (await row('j1'))?.ping != null);
    expect(await row('j1')).toMatchObject({
      online: true,
      slots: 3,
      busy: 0,
      build: 'fake-judge',
      lastIp: '127.0.0.1',
      load: 0.25,
      runtimes: [
        { language: 'CPP17', name: 'CPP17', version: '1', priority: 0 },
      ],
    });
    await fake.close();
    await waitUntil(async () => (await row('j1'))?.online === false);
  });

  it.each([
    ['a wrong key', judge('j1', { key: 'nope' })],
    ['an unknown name', judge('ghost')],
    ['a blocked judge', judge('blocked')],
  ])(
    'refuses %s with UNAUTHENTICATED before reading anything',
    async (_why, options) => {
      const fake = FakeJudge.open(bridge.judgePort(), options);
      fake.hello();
      expect((await fake.closed).code).toBe(status.UNAUTHENTICATED);
      expect(fake.received).toEqual([]);
    },
  );

  it('refuses the stored hash presented as the key: only sha256 of the key is compared', async () => {
    const fake = FakeJudge.open(
      bridge.judgePort(),
      judge('j1', { key: sha256('j1-key') }),
    );
    fake.hello();
    expect((await fake.closed).code).toBe(status.UNAUTHENTICATED);
  });

  it('refuses a key longer than 256 characters before checking it', async () => {
    const long = 'k'.repeat(257);
    await seedJudge(bridge, 'long-key', long);
    const fake = FakeJudge.open(bridge.judgePort(), {
      name: 'long-key',
      key: long,
    });
    fake.hello();
    expect((await fake.closed).code).toBe(status.UNAUTHENTICATED);
  });

  it('drops a judge whose key the api rotates, then refuses the old key and serves the new one', async () => {
    await seedJudge(bridge, 'rotating', 'rotating-key');
    const fake = await FakeJudge.online(bridge.judgePort(), judge('rotating'));
    // what the api's rotateKey writes and publishes
    await bridge.judges.updateOne(
      { name: 'rotating' },
      { $set: { authKeyHash: sha256('rotating-new') } },
    );
    await commands.publish({
      type: 'disconnect-judge',
      judgeName: 'rotating',
      force: true,
    });
    expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
    const old = FakeJudge.open(bridge.judgePort(), judge('rotating'));
    old.hello();
    expect((await old.closed).code).toBe(status.UNAUTHENTICATED);
    const renewed = await FakeJudge.online(
      bridge.judgePort(),
      judge('rotating', { key: 'rotating-new' }),
    );
    expect(renewed.sessionId).not.toBe('');
    await renewed.close();
  });

  it('ends a session that sends no Hello in time', async () => {
    const fake = FakeJudge.open(bridge.judgePort(), judge('j2'));
    expect((await fake.closed).code).toBe(status.DEADLINE_EXCEEDED);
  });

  it('refuses a message over 4 MiB', async () => {
    const fake = await FakeJudge.online(bridge.judgePort(), judge('j2'));
    fake.send({
      $case: 'error',
      error: JudgeError.fromPartial({
        message: 'x'.repeat(4 * 1024 * 1024 + 100),
      }),
    });
    expect((await fake.closed).code).toBe(status.RESOURCE_EXHAUSTED);
  });

  it('closes the ninth socket from one address that has no authenticated session, and does not count judges', async () => {
    const online = await FakeJudge.online(bridge.judgePort(), judge('j1'));
    const idle = await Promise.all(
      Array.from({ length: 8 }, () => rawSocket(bridge.judgePort())),
    );
    const ninth = await rawSocket(bridge.judgePort());
    expect(await closedSoon(ninth)).toBe(true);
    expect(online.isClosed).toBe(false);
    idle.forEach((socket) => socket.destroy());
    await online.close();
  });

  it('replaces a session with a newer one of the same judge: the old one is told and ends ABORTED', async () => {
    const first = await FakeJudge.online(bridge.judgePort(), judge('j2'));
    const second = await FakeJudge.online(bridge.judgePort(), judge('j2'));
    expect((await first.closed).code).toBe(status.ABORTED);
    expect(
      first.seen('disconnect').map(({ disconnect }) => disconnect.forced),
    ).toEqual([false]);
    expect(second.isClosed).toBe(false);
    expect((await row('j2'))?.online).toBe(true);
    await second.close();
  });

  it('grades a submission through the session, acking every message, and a forced admin disconnect ends it with PERMISSION_DENIED', async () => {
    const catalog = await seedCatalog(bridge);
    const problem = await seedProblem(bridge, catalog, { code: 'p1' });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const fake = await FakeJudge.online(bridge.judgePort(), judge('j1'));
    await commands.judge([submission._id]);
    const assign = await fake.nextAssign();
    expect(assign).toMatchObject({
      problemCode: 'p1',
      languageKey: 'CPP17',
      ref: { submissionId: submission._id, generation: 1 },
    });
    expect(Buffer.from(assign.source).toString()).toBe('int main() {}');
    await fake.grade(assign.ref!, [
      { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
    ]);
    expect(fake.seen('ack').map(({ ack }) => ack.seq)).toEqual([1, 2, 3, 4]);
    expect(
      await bridge.submissions.findById(submission._id).lean(),
    ).toMatchObject({
      status: 'D',
      result: 'AC',
      judgeGeneration: 1,
      judgeSeq: 4,
    });
    await commands.publish({
      type: 'disconnect-judge',
      judgeName: 'j1',
      force: true,
    });
    expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
  });

  it('ends every session with UNAVAILABLE when the bridge stops', async () => {
    const fake = await FakeJudge.online(bridge.judgePort(), judge('j1'));
    await bridge.restart();
    expect(await fake.closed).toMatchObject({
      code: status.UNAVAILABLE,
      details: 'the bridge is stopping',
    });
  });
});

describe('Judge link over TLS', () => {
  let bridge: BridgeTest;
  let ca: Buffer;
  beforeAll(async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qhhoj-bridge-tls-'));
    const [cert, key] = [
      join(directory, 'cert.pem'),
      join(directory, 'key.pem'),
    ];
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    ca = readFileSync(cert);
    bridge = await setupBridgeTest({
      env: { JUDGE_BRIDGE_TLS_CERT: cert, JUDGE_BRIDGE_TLS_KEY: key },
    });
    await seedJudge(bridge, 'j1', 'j1-key');
  });
  afterAll(() => bridge.teardown());

  it('serves a judge that pins the certificate, and no plaintext client', async () => {
    const secure = await FakeJudge.online(bridge.judgePort(), {
      ...judge('j1'),
      ca,
    });
    expect(secure.sessionId).not.toBe('');
    await secure.close();
    const plain = FakeJudge.open(bridge.judgePort(), judge('j1'));
    plain.hello();
    expect((await plain.closed).code).toBe(status.UNAVAILABLE);
  });
});

describe('Judge key changes whose command was lost', () => {
  let bridge: BridgeTest;
  beforeAll(async () => {
    bridge = await setupBridgeTest({ timings: { resyncMs: 200 } });
  });
  afterAll(() => bridge.teardown());

  it.each([
    ['its key is rotated', { authKeyHash: sha256('rotated-key') }],
    ['it is blocked', { isBlocked: true }],
  ])(
    'the resync force-disconnects a connected judge when %s',
    async (_why, change) => {
      const name = `live-${Object.keys(change)[0]}`;
      await seedJudge(bridge, name, `${name}-key`);
      const fake = await FakeJudge.online(bridge.judgePort(), judge(name));
      await bridge.judges.updateOne({ name }, { $set: change });
      expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
      expect(
        fake.seen('disconnect').map(({ disconnect }) => disconnect.forced),
      ).toEqual([true]);
    },
  );
});
