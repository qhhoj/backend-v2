import { status } from '@grpc/grpc-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { sha256 } from '@libs/auth';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { JudgeError, Status } from '@libs/judge-proto';
import { BridgeCommandsService } from '@libs/judging';
import { JudgesRepository } from '../../api/src/modules/judges/judges.repository';
import { JudgesService } from '../../api/src/modules/judges/judges.service';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
} from './fixtures';
import { TIMER_HANDSHAKE_CLOCK } from '../src/link/handshake-clock';
import type { HandshakeClock } from '../src/link/handshake-clock';
import { JudgeLinkServer } from '../src/link/judge-link.server';
import type { JudgeSession } from '../src/link/judge-session';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

/** Sessions the bridge's link server holds for `name` (private state: what the bridge has seen, not the clock). */
const sessionsOf = (bridge: BridgeTest, name: string): JudgeSession[] =>
  [
    ...bridge.module.get<JudgeLinkServer, { sessions: Set<JudgeSession> }>(
      JudgeLinkServer,
    ).sessions,
  ].filter((session) => session.name === name);
/** Sockets the link server's guard holds an open session of `name` on (private state: a session that passed its key check marks its socket). */
const markedSocketsOf = (bridge: BridgeTest, name: string): number =>
  [
    ...bridge.module
      .get<
        JudgeLinkServer,
        { guard: { sockets: Map<string, { open: Map<string, number> }> } }
      >(JudgeLinkServer)
      .guard.sockets.values(),
  ].filter((socket) => socket.open.has(name)).length;
/** The bridge authenticated a session of `name` that has not said Hello. */
const handshakeSeen = (bridge: BridgeTest, name: string) =>
  waitUntil(() =>
    sessionsOf(bridge, name).some((session) => !session.hasHelloed),
  );
/** Real Hello deadlines, no socket deadline: a TLS handshake and key check slower than `handshakeMs` on a loaded host cannot end a session before its Hello is due. */
const HELLO_DEADLINE_ONLY: HandshakeClock = {
  arm: (owner, ms, fire) =>
    'judge' in owner
      ? TIMER_HANDSHAKE_CLOCK.arm(owner, ms, fire)
      : () => undefined,
};
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

  describe('driven by the api judges service (admin path)', () => {
    const admin = () =>
      new JudgesService(
        new JudgesRepository(bridge.judges, bridge.submissions),
        commands,
      );

    it('rotating the key closes the judge, refuses the old key and serves the new one', async () => {
      await seedJudge(bridge, 'admin-rot', 'admin-rot-key');
      const fake = await FakeJudge.online(
        bridge.judgePort(),
        judge('admin-rot'),
      );
      // a session still before its Hello is ended by the revoke alone
      const handshaking = FakeJudge.open(
        bridge.judgePort(),
        judge('admin-rot'),
      );
      await handshakeSeen(bridge, 'admin-rot');
      const { authKey } = await admin().rotateKey('admin-rot');
      expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
      expect((await handshaking.closed).code).toBe(status.PERMISSION_DENIED);
      const old = FakeJudge.open(bridge.judgePort(), judge('admin-rot'));
      old.hello();
      expect((await old.closed).code).toBe(status.UNAUTHENTICATED);
      const renewed = await FakeJudge.online(
        bridge.judgePort(),
        judge('admin-rot', { key: authKey }),
      );
      await renewed.close();
    });

    it('blocking closes the judge and keeps it out until it is unblocked', async () => {
      await seedJudge(bridge, 'admin-block', 'admin-block-key');
      const fake = await FakeJudge.online(
        bridge.judgePort(),
        judge('admin-block'),
      );
      // a session still before its Hello is ended by the revoke alone
      const handshaking = FakeJudge.open(
        bridge.judgePort(),
        judge('admin-block'),
      );
      await handshakeSeen(bridge, 'admin-block');
      await admin().update('admin-block', { isBlocked: true });
      expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
      expect((await handshaking.closed).code).toBe(status.PERMISSION_DENIED);
      const refused = FakeJudge.open(bridge.judgePort(), judge('admin-block'));
      refused.hello();
      expect((await refused.closed).code).toBe(status.UNAUTHENTICATED);
      await admin().update('admin-block', { isBlocked: false });
      const back = await FakeJudge.online(
        bridge.judgePort(),
        judge('admin-block'),
      );
      await back.close();
    });
  });
});

/** A self-signed localhost certificate and its key, written to a fresh directory. */
const selfSigned = () => {
  const directory = mkdtempSync(join(tmpdir(), 'qhhoj-bridge-tls-'));
  const [cert, key] = [join(directory, 'cert.pem'), join(directory, 'key.pem')];
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
  return { cert, key };
};

describe('Judge link over TLS', () => {
  let bridge: BridgeTest;
  let ca: Buffer;
  beforeAll(async () => {
    const { cert, key } = selfSigned();
    ca = readFileSync(cert);
    bridge = await setupBridgeTest({
      env: { JUDGE_BRIDGE_TLS_CERT: cert, JUDGE_BRIDGE_TLS_KEY: key },
      handshakeClock: HELLO_DEADLINE_ONLY,
    });
    await seedJudge(bridge, 'j1', 'j1-key');
  });
  afterAll(() => bridge.teardown());

  // first in this block: one line per address and minute, so a later failure here would not be logged
  it('serves a judge that pins the certificate, and no plaintext client', async () => {
    const secure = await FakeJudge.online(bridge.judgePort(), {
      ...judge('j1'),
      ca,
    });
    expect(secure.sessionId).not.toBe('');
    // a session marks its socket only if grpc-js reports the TLS peer as the socket does
    expect(markedSocketsOf(bridge, 'j1')).toBe(1);
    expect(secure.isClosed).toBe(false);
    await secure.close();
    const plain = FakeJudge.open(bridge.judgePort(), judge('j1'));
    plain.hello();
    expect((await plain.closed).code).toBe(status.UNAVAILABLE);
  });

  it('ends a TLS session that sends no Hello in time with DEADLINE_EXCEEDED', async () => {
    const fake = FakeJudge.open(bridge.judgePort(), { ...judge('j1'), ca });
    expect((await fake.closed).code).toBe(status.DEADLINE_EXCEEDED);
  });
});

describe('Judge key changes whose command was lost', () => {
  let bridge: BridgeTest;
  beforeAll(async () => {
    // a long deadline: a closed socket was closed by the revoke
    bridge = await setupBridgeTest({
      timings: { resyncMs: 200, handshakeMs: 5000 },
    });
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
      expect(await fake.connectionLost(2500)).toBe(true);
      await fake.close();
    },
  );
});
