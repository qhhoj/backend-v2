import { status } from '@grpc/grpc-js';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Model } from 'mongoose';
import { sha256 } from '@libs/auth';
import { TEST_ENV, TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import {
  Judge,
  Language,
  Problem,
  Submission,
  SubmissionSource,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { JudgeError, Status } from '@libs/judge-proto';
import { BridgeCoreModule } from '../src/bridge-core.module';
import { BRIDGE_TIMINGS } from '../src/bridge-timings';
import { DispatcherService } from '../src/dispatch/dispatcher.service';
import { JudgesRepository } from '../src/judges/judges.repository';
import { JudgeLinkServer } from '../src/link/judge-link.server';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import { FakeJudge } from './link-judge';
import { FAST_TIMINGS } from './setup';

/** The judge side alone (BridgeCoreModule), started the way BridgeService starts it: until the switch, BridgeModule still serves the DMOJ transport. */
async function startLink(env: Record<string, string> = {}) {
  const replSet: MongoMemoryReplSet = await startMongo();
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: replSet.getUri('qhhoj'),
    MEDIA_ROOT: tmpdir(),
    PROBLEM_DATA_ROOT: tmpdir(),
    PDF_CACHE_ROOT: tmpdir(),
    JUDGE_BRIDGE_HOST: '127.0.0.1',
    JUDGE_BRIDGE_PORT: '0',
    JUDGE_BRIDGE_TLS_CERT: '',
    JUDGE_BRIDGE_TLS_KEY: '',
    ...env,
  });
  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  await redis.quit();
  const module: TestingModule = await Test.createTestingModule({
    imports: [BridgeCoreModule],
  })
    .overrideProvider(BRIDGE_TIMINGS)
    .useValue(FAST_TIMINGS)
    .compile();
  await module.init();
  const server = module.get(JudgeLinkServer);
  const port = await server.listen();
  server.acceptJudges();
  const model = <Entity>(name: string) =>
    module.get<Model<Entity>>(getModelToken(name));
  return {
    port,
    module,
    model,
    judges: model<Judge>(Judge.name),
    submissions: model<Submission>(Submission.name),
    stop: async () => {
      module.get(DispatcherService).stop();
      await server.close();
      await module.close();
      await replSet.stop();
    },
  };
}
type Link = Awaited<ReturnType<typeof startLink>>;

/** A CPP17 problem `p1` and one queued submission of it. */
async function seedOne(link: Link): Promise<string> {
  const [language] = await link.model<Language>(Language.name).create([
    {
      key: 'CPP17',
      name: 'C++17',
      commonName: 'C++',
      ace: 'c_cpp',
      pygments: 'cpp',
      extension: 'cpp',
    },
  ]);
  const user = await link
    .model<User>(User.name)
    .create({ username: 'alice', password: '!', isActive: true });
  const problem = await link.model<Problem>(Problem.name).create({
    code: 'p1',
    name: 'P1',
    timeLimit: 1,
    memoryLimit: 65536,
    points: 1000,
    typeIds: [language._id],
    groupId: language._id,
    allowedLanguages: [language._id],
  });
  const submission = await link.submissions.create({
    user: user._id,
    problem: problem._id,
    language: language._id,
  });
  await link
    .model<SubmissionSource>(SubmissionSource.name)
    .create({ _id: submission._id, source: 'int main() {}' });
  return submission._id;
}

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
  let link: Link;
  const row = async (name: string) => link.judges.findOne({ name }).lean();
  beforeAll(async () => {
    link = await startLink();
    await link.judges.create([
      { name: 'j1', authKeyHash: sha256('j1-key') },
      { name: 'j2', authKeyHash: sha256('j2-key') },
      { name: 'blocked', authKeyHash: sha256('blocked-key'), isBlocked: true },
    ]);
  });
  afterAll(() => link.stop());

  it('marks a judge online with what its Hello reports, records its pongs, and marks it offline when it leaves', async () => {
    const fake = await FakeJudge.online(
      link.port,
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
      const fake = FakeJudge.open(link.port, options);
      fake.hello();
      expect((await fake.closed).code).toBe(status.UNAUTHENTICATED);
      expect(fake.received).toEqual([]);
    },
  );

  it('refuses the stored hash presented as the key: only sha256 of the key is compared', async () => {
    const fake = FakeJudge.open(
      link.port,
      judge('j1', { key: sha256('j1-key') }),
    );
    fake.hello();
    expect((await fake.closed).code).toBe(status.UNAUTHENTICATED);
  });

  it('refuses a key longer than 256 characters before checking it', async () => {
    const long = 'k'.repeat(257);
    await link.judges.create({ name: 'long-key', authKeyHash: sha256(long) });
    const fake = FakeJudge.open(link.port, { name: 'long-key', key: long });
    fake.hello();
    expect((await fake.closed).code).toBe(status.UNAUTHENTICATED);
  });

  it.each([
    ['its key is rotated', { authKeyHash: sha256('rotated-key') }],
    ['it is blocked', { isBlocked: true }],
  ])(
    'force-disconnects a connected judge when %s and the resync reconciles it',
    async (_why, change) => {
      const name = `live-${Object.keys(change)[0]}`;
      await link.judges.create({ name, authKeyHash: sha256(`${name}-key`) });
      const fake = await FakeJudge.online(link.port, judge(name));
      await link.judges.updateOne({ name }, { $set: change });
      await link.module
        .get(DispatcherService)
        .reconcile(await link.module.get(JudgesRepository).accessOf([name]));
      expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
      expect(
        fake.seen('disconnect').map(({ disconnect }) => disconnect.forced),
      ).toEqual([true]);
    },
  );

  it('after a key rotation, refuses the old key and serves the new one', async () => {
    await link.judges.create({
      name: 'rotating',
      authKeyHash: sha256('rotating-key'),
    });
    await link.judges.updateOne(
      { name: 'rotating' },
      { $set: { authKeyHash: sha256('rotating-new') } },
    );
    const old = FakeJudge.open(link.port, judge('rotating'));
    old.hello();
    expect((await old.closed).code).toBe(status.UNAUTHENTICATED);
    const renewed = await FakeJudge.online(
      link.port,
      judge('rotating', { key: 'rotating-new' }),
    );
    expect(renewed.sessionId).not.toBe('');
    await renewed.close();
  });

  it('ends a session that sends no Hello in time', async () => {
    const fake = FakeJudge.open(link.port, judge('j2'));
    expect((await fake.closed).code).toBe(status.DEADLINE_EXCEEDED);
  });

  it('refuses a message over 4 MiB', async () => {
    const fake = await FakeJudge.online(link.port, judge('j2'));
    fake.send({
      $case: 'error',
      error: JudgeError.fromPartial({
        message: 'x'.repeat(4 * 1024 * 1024 + 100),
      }),
    });
    expect((await fake.closed).code).toBe(status.RESOURCE_EXHAUSTED);
  });

  it('closes the ninth socket from one address that has no authenticated session, and does not count judges', async () => {
    const online = await FakeJudge.online(link.port, judge('j1'));
    const idle = await Promise.all(
      Array.from({ length: 8 }, () => rawSocket(link.port)),
    );
    const ninth = await rawSocket(link.port);
    expect(await closedSoon(ninth)).toBe(true);
    expect(online.isClosed).toBe(false);
    idle.forEach((socket) => socket.destroy());
    await online.close();
  });

  it('replaces a session with a newer one of the same judge: the old one is told and ends ABORTED', async () => {
    const first = await FakeJudge.online(link.port, judge('j2'));
    const second = await FakeJudge.online(link.port, judge('j2'));
    expect((await first.closed).code).toBe(status.ABORTED);
    expect(
      first.seen('disconnect').map(({ disconnect }) => disconnect.forced),
    ).toEqual([false]);
    expect(second.isClosed).toBe(false);
    expect((await row('j2'))?.online).toBe(true);
    await second.close();
  });

  it('grades a submission through the session, acking every message, and force-disconnects with PERMISSION_DENIED', async () => {
    const id = await seedOne(link);
    const fake = await FakeJudge.online(link.port, judge('j1'));
    const dispatch = link.module.get(DispatcherService);
    await dispatch.enqueue(
      await link.module.get(SubmissionsRepository).loadQueued([id]),
    );
    const assign = await fake.nextAssign();
    expect(assign).toMatchObject({
      problemCode: 'p1',
      languageKey: 'CPP17',
      ref: { submissionId: id, generation: 1 },
    });
    expect(Buffer.from(assign.source).toString()).toBe('int main() {}');
    await fake.grade(assign.ref!, [
      { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
    ]);
    expect(fake.seen('ack').map(({ ack }) => ack.seq)).toEqual([1, 2, 3, 4]);
    expect(await link.submissions.findById(id).lean()).toMatchObject({
      status: 'D',
      result: 'AC',
      judgeGeneration: 1,
      judgeSeq: 4,
    });
    dispatch.disconnect('j1', { isForced: true });
    expect((await fake.closed).code).toBe(status.PERMISSION_DENIED);
  });

  it('ends every session with UNAVAILABLE when the bridge stops', async () => {
    const other = await startLink();
    await other.judges.create({ name: 'j1', authKeyHash: sha256('j1-key') });
    const fake = await FakeJudge.online(other.port, judge('j1'));
    await other.stop();
    expect(await fake.closed).toMatchObject({
      code: status.UNAVAILABLE,
      details: 'the bridge is stopping',
    });
  });
});

describe('Judge link over TLS', () => {
  let link: Link;
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
    link = await startLink({
      JUDGE_BRIDGE_TLS_CERT: cert,
      JUDGE_BRIDGE_TLS_KEY: key,
    });
    await link.judges.create({ name: 'j1', authKeyHash: sha256('j1-key') });
  });
  afterAll(() => link.stop());

  it('serves a judge that pins the certificate, and no plaintext client', async () => {
    const secure = await FakeJudge.online(link.port, { ...judge('j1'), ca });
    expect(secure.sessionId).not.toBe('');
    await secure.close();
    const plain = FakeJudge.open(link.port, judge('j1'));
    plain.hello();
    expect((await plain.closed).code).toBe(status.UNAVAILABLE);
  });
});
