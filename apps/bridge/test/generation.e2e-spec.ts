import { status } from '@grpc/grpc-js';
import { randomBytes } from 'node:crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import Redis from 'ioredis';
import type { Connection } from 'mongoose';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import {
  GenerationFailure_Kind,
  GenerationFailure_Stage,
  GenerationProgram_Role,
} from '@libs/judge-proto';
import {
  BridgeCommandsService,
  GENERATE_FEATURE,
  generationBucket,
} from '@libs/judging';
import type { GenerationPlan } from '@libs/judging';
import { DispatcherService } from '../src/dispatch/dispatcher.service';
import { GENERATION_RETENTION_MS } from '../src/generations/generations.repository';
import { FakeJudge } from './fake-judge';
import { seedJudge } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const MIB = 1024 * 1024;
const GRACE_MS = 300;
const LIMITS = { timeS: 10, wallS: 20, memoryKib: 1024 };
const PLAN: GenerationPlan = {
  deadlineS: 600,
  limits: {
    generator: LIMITS,
    validator: LIMITS,
    solution: { timeS: 2, wallS: 7, memoryKib: 262144 },
    maxFileBytes: MIB,
    maxTotalBytes: 4 * MIB,
    maxUploadBytes: 3 * MIB,
  },
  programs: [
    {
      name: 'gen',
      role: 'GENERATOR',
      languageKey: 'CPP17',
      sourcePath: 'files/gen.cpp',
    },
    {
      name: 'sol',
      role: 'SOLUTION',
      languageKey: 'PY3',
      sourcePath: 'sol/main.py',
    },
  ],
  tests: [
    {
      index: 1,
      inputName: '01.inp',
      answerName: '01.out',
      group: 'g1',
      manualPath: '',
      generator: 'gen',
      args: ['3', 'x'],
    },
  ],
  inputFile: '',
  outputFile: '',
};

describe('Test generation (bridge + gRPC FakeJudge)', () => {
  let bridge: BridgeTest;
  let connection: Connection;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const judges: FakeJudge[] = [];
  let names = 0;

  const online = async (
    options: { features?: string[]; slots?: number } = {},
  ) => {
    const name = `gj-${(names += 1)}`;
    await seedJudge(bridge, name, `${name}-key`);
    const judge = await FakeJudge.online(bridge.judgePort(), {
      name,
      key: `${name}-key`,
      ...options,
    });
    judges.push(judge);
    return judge;
  };
  const capable = (slots = 2) =>
    online({ features: [GENERATE_FEATURE], slots });
  const row = async (id: string) =>
    (await bridge.generations.findById(id).lean())!;
  const filesOf = (id: string) =>
    generationBucket(connection)
      .find({ 'metadata.generationId': id })
      .toArray();

  const seed = async (
    bundle = randomBytes(10),
    plan: GenerationPlan = PLAN,
  ) => {
    const file = generationBucket(connection).openUploadStream('bundle.zip');
    await new Promise<void>((resolve, reject) =>
      file
        .once('finish', () => resolve())
        .once('error', reject)
        .end(bundle),
    );
    const created = await bridge.generations.create({
      status: 'queued',
      plan,
      bundleFileId: file.id,
      bundleSize: bundle.length,
    });
    return created._id;
  };
  const publish = async (id: string) => {
    await commands.generate(id);
  };
  const statusOf = (id: string) => async () => (await row(id)).status;
  const toBe = (id: string, expected: string) =>
    waitUntil(async () => (await row(id)).status === expected);

  beforeAll(async () => {
    bridge = await setupBridgeTest({
      timings: { generationGraceMs: GRACE_MS },
    });
    connection = bridge.module.get<Connection>(getConnectionToken());
  });
  afterEach(async () => {
    await Promise.all(judges.splice(0).map((judge) => judge.close()));
    await bridge.generations.deleteMany({});
    await generationBucket(connection)
      .drop()
      .catch(() => undefined);
  });
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  it('sends a queued generation only to a judge that advertises the feature, and claims the row for its session', async () => {
    const plain = await online({ slots: 2 });
    const feature = await capable();
    const id = await seed(randomBytes(10));
    await publish(id);

    const { generate } = await feature.next('generate');
    expect(generate).toMatchObject({
      generationId: id,
      bundleSize: 10,
      deadlineS: 600,
      inputFile: '',
      outputFile: '',
    });
    expect(generate.programs.map((program) => program.role)).toEqual([
      GenerationProgram_Role.ROLE_GENERATOR,
      GenerationProgram_Role.ROLE_SOLUTION,
    ]);
    expect(generate.tests[0]).toMatchObject({
      generator: 'gen',
      args: ['3', 'x'],
      group: 'g1',
    });
    expect(generate.limits?.maxUploadBytes).toBe(3 * MIB);
    const claimed = await row(id);
    expect(claimed).toMatchObject({
      status: 'running',
      sessionId: feature.sessionId,
    });
    expect(claimed.judge).toMatch(/^gj-/);
    expect(claimed.startedAt).toBeInstanceOf(Date);
    expect(plain.seen('generate')).toEqual([]);
  });

  it('dispatches a queued row the resync finds when no command announced it', async () => {
    const id = await seed();
    const judge = await capable();
    await bridge.module.get(DispatcherService).resyncGenerations();
    expect((await judge.next('generate')).generate.generationId).toBe(id);
  });

  it('serves the bundle in chunks of at most 1 MiB to the holding session only', async () => {
    const bundle = randomBytes(2 * MIB + 12345);
    const holder = await capable();
    const other = await capable();
    const id = await seed(bundle);
    await publish(id);
    await holder.next('generate');

    const fetched = await holder.fetchGenerationBundle(id);
    expect(fetched.code).toBe(status.OK);
    expect(fetched.data.equals(bundle)).toBe(true);
    expect(fetched.biggestChunk).toBeLessThanOrEqual(MIB);
    expect((await other.fetchGenerationBundle(id, other.sessionId)).code).toBe(
      status.PERMISSION_DENIED,
    );
    expect(
      (await holder.fetchGenerationBundle(id, 'another-session')).code,
    ).toBe(status.PERMISSION_DENIED);
  });

  it('stores an upload in GridFS, accepts it once, and marks the row done on GenerationDone', async () => {
    const judge = await capable();
    const id = await seed();
    await publish(id);
    await judge.next('generate');
    const zip = randomBytes(MIB + 7);

    expect(
      await judge.uploadGeneratedTests(id, [
        zip.subarray(0, MIB),
        zip.subarray(MIB),
      ]),
    ).toEqual({
      code: status.OK,
      bytes: zip.length,
    });
    expect((await judge.uploadGeneratedTests(id, [zip])).code).toBe(
      status.ALREADY_EXISTS,
    );
    judge.generationDone(id);
    await toBe(id, 'done');

    const done = await row(id);
    expect(done.endedAt).toEqual(expect.any(Date));
    const stored = await generationBucket(connection)
      .openDownloadStream(done.resultFileId as never)
      .toArray();
    expect(Buffer.concat(stored).equals(zip)).toBe(true);
  });

  it('refuses an upload over the plan cap with RESOURCE_EXHAUSTED and leaves no file behind', async () => {
    const judge = await capable();
    const id = await seed();
    await publish(id);
    await judge.next('generate');
    const chunks = [0, 1, 2, 3].map(() => randomBytes(MIB));

    expect((await judge.uploadGeneratedTests(id, chunks)).code).toBe(
      status.RESOURCE_EXHAUSTED,
    );
    await waitUntil(async () => (await filesOf(id)).length === 0);
    expect((await row(id)).resultFileId).toBeNull();
  });

  it('refuses an upload for a generation the session does not hold', async () => {
    const judge = await capable();
    const stranger = await capable();
    const id = await seed();
    await publish(id);
    await waitUntil(async () => (await row(id)).status === 'running');
    const outsider =
      (await row(id)).sessionId === judge.sessionId ? stranger : judge;

    expect(
      (await outsider.uploadGeneratedTests(id, [randomBytes(5)])).code,
    ).toBe(status.PERMISSION_DENIED);
    expect((await row(id)).resultFileId).toBeNull();
  });

  it('fails the row when GenerationDone says ok but nothing was uploaded', async () => {
    const judge = await capable();
    const id = await seed();
    await publish(id);
    await judge.next('generate');
    judge.generationDone(id);
    await toBe(id, 'failed');
    expect((await row(id)).failure).toMatchObject({
      stage: 'JOB',
      kind: 'INTERNAL',
    });
  });

  it('stores the judge failure without the proto prefixes and frees the slot for the next generation', async () => {
    const judge = await capable(2);
    const [first, second] = [await seed(), await seed()];
    await publish(first);
    await judge.next('generate');
    judge.generationDone(first, {
      stage: GenerationFailure_Stage.STAGE_VALIDATE,
      kind: GenerationFailure_Kind.KIND_REJECTED,
      program: 'val',
      testIndex: 17,
      detail: 'bad input',
    });
    await toBe(first, 'failed');
    expect((await row(first)).failure).toEqual({
      stage: 'VALIDATE',
      kind: 'REJECTED',
      program: 'val',
      testIndex: 17,
      detail: 'bad input',
    });
    await publish(second);
    expect((await judge.next('generate')).generate.generationId).toBe(second);
  });

  it('never takes the last free slot of a multi-slot judge, but a 1-slot judge runs one when idle', async () => {
    const two = await capable(2);
    const ids = [await seed(), await seed(), await seed()];
    for (const id of ids) await publish(id);
    await two.next('generate');
    await waitUntil(
      async () =>
        (await bridge.generations.countDocuments({ status: 'running' })) === 1,
    );
    expect(await bridge.generations.countDocuments({ status: 'queued' })).toBe(
      2,
    );

    const single = await capable(1);
    await single.next('generate');
    expect(await bridge.generations.countDocuments({ status: 'running' })).toBe(
      2,
    );
  });

  it('fails the row with "judge disconnected" when the judge leaves, and requeues nothing', async () => {
    const judge = await capable();
    const id = await seed();
    await publish(id);
    await judge.next('generate');
    await judge.close();

    await toBe(id, 'failed');
    expect((await row(id)).failure).toEqual({
      stage: 'JOB',
      kind: 'INTERNAL',
      program: '',
      testIndex: 0,
      detail: 'judge disconnected',
    });
  });

  it('cancels a generation past its deadline plus grace and fails it with JOB_TIME_LIMIT', async () => {
    const judge = await capable();
    const id = await seed(randomBytes(5), { ...PLAN, deadlineS: 0 });
    await publish(id);
    await judge.next('generate');

    expect(
      (await judge.next('cancelGeneration')).cancelGeneration.generationId,
    ).toBe(id);
    await toBe(id, 'failed');
    expect((await row(id)).failure).toMatchObject({
      stage: 'JOB',
      kind: 'JOB_TIME_LIMIT',
    });
  });

  it('ignores a GenerationDone that arrives after the row failed', async () => {
    const judge = await capable();
    const id = await seed(randomBytes(5), { ...PLAN, deadlineS: 0 });
    await publish(id);
    await judge.next('generate');
    await toBe(id, 'failed');
    await judge.uploadGeneratedTests(id, [randomBytes(3)]);
    judge.generationDone(id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await statusOf(id)()).toBe('failed');
  });

  it('resync fails running rows no live session holds and removes expired rows with their files', async () => {
    const stranded = await seed();
    await bridge.generations.updateOne(
      { _id: stranded },
      {
        status: 'running',
        judge: 'gone',
        sessionId: 'old',
        startedAt: new Date(),
      },
    );
    const expired = await seed();
    const old = new Date(Date.now() - GENERATION_RETENTION_MS - 60_000);
    await bridge.generations.updateOne(
      { _id: expired },
      { status: 'done', endedAt: old },
    );
    const expiredRow = await row(expired);

    await bridge.module.get(DispatcherService).resyncGenerations();

    expect((await row(stranded)).status).toBe('failed');
    expect(await bridge.generations.findById(expired)).toBeNull();
    const left = await generationBucket(connection)
      .find({ _id: expiredRow.bundleFileId as never })
      .toArray();
    expect(left).toEqual([]);
  });
});
