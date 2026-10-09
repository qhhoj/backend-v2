import { status } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Submission } from '@libs/database';
import Redis from 'ioredis';
import { sha256 } from '@libs/auth';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { BridgeCommandsService } from '@libs/judging';
import { recordSubmissionEvents } from '@libs/judging/testing';
import { Outcome, Resume_Action, Status } from '@libs/judge-proto';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { BridgeModule } from '../src/bridge.module';
import { DispatcherService } from '../src/dispatch/dispatcher.service';
import { JudgeLinkServer } from '../src/link/judge-link.server';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const KEY = 'restart key';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Bridge restart', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let codes = 0;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const submissionRow = async (id: string) =>
    (await bridge.submissions.findById(id).select('+cases').lean())!;
  const connect = (name: string, extra: object = {}) =>
    FakeJudge.online(bridge.judgePort(), { name, key: KEY, ...extra });
  const seedOne = async (fields: Partial<Submission> = {}) => {
    const problem = await seedProblem(bridge, catalog, {
      code: `restart${(codes += 1)}`,
    });
    return (
      await seedSubmission(bridge, catalog, { problem: problem._id, ...fields })
    )._id;
  };

  beforeAll(async () => {
    bridge = await setupBridgeTest({
      timings: { resyncMs: 300, resumeGraceMs: 30_000 },
    });
    catalog = await seedCatalog(bridge);
  });
  // judges see every problem: nothing a test leaves queued or running may reach the next test's judge
  afterEach(() =>
    bridge.submissions.updateMany(
      { status: { $in: ['QU', 'P', 'G'] } },
      { $set: { status: 'AB', result: 'AB' } },
    ),
  );
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  it('a restart while grading leaves the run to its judge, which resumes it: no requeue, no IE', async () => {
    await seedJudge(bridge, 'restart-1', KEY);
    const id = await seedOne();
    await commands.judge([id]);
    const judge = await connect('restart-1');
    const ref = (await judge.nextAssign()).ref!;
    judge.accept(ref);
    judge.started(ref, 1);
    await judge.ackOf(ref, 2);
    await bridge.restart();
    expect((await judge.closed).code).toBe(status.UNAVAILABLE);
    expect(await submissionRow(id)).toMatchObject({
      status: 'G',
      judgedOn: 'restart-1',
      judgeSeq: 2,
      requeueCount: 0,
    });
    expect(
      (await bridge.judges.findOne({ name: 'restart-1' }).lean())?.online,
    ).toBe(false);
    const again = FakeJudge.open(bridge.judgePort(), {
      name: 'restart-1',
      key: KEY,
      inFlight: [{ ref, lastSeqSent: 2 }],
    });
    again.hello();
    const { welcome } = await again.next('welcome');
    expect(welcome.resume).toEqual([
      { ref, action: Resume_Action.ACTION_CONTINUE, fromSeq: 3 },
    ]);
    again.cases(ref, [
      { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
    ]);
    again.final(ref, Outcome.OUTCOME_GRADED);
    await waitUntil(async () => (await submissionRow(id)).status === 'D');
    expect(await submissionRow(id)).toMatchObject({
      result: 'AC',
      requeueCount: 0,
      judgeGeneration: 1,
    });
    await again.close();
  });

  it('a judge replays its outbox after a restart: every run resumes, a repeated message is not applied twice, nothing is lost', async () => {
    await seedJudge(bridge, 'restart-19', KEY);
    const [first, second] = [await seedOne(), await seedOne()];
    await commands.judge([first, second]);
    const judge = await connect('restart-19', { slots: 2 });
    const refs = [
      (await judge.nextAssign()).ref!,
      (await judge.nextAssign()).ref!,
    ];
    const [one, two] = refs;
    judge.accept(one);
    judge.started(one, 1);
    judge.cases(one, [
      { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
    ]);
    judge.accept(two);
    await judge.ackOf(one, 3);
    await judge.ackOf(two, 1);
    await bridge.restart();
    await judge.closed;
    const again = FakeJudge.open(bridge.judgePort(), {
      name: 'restart-19',
      key: KEY,
      slots: 2,
      inFlight: [
        { ref: one, lastSeqSent: 3 },
        { ref: two, lastSeqSent: 1 },
      ],
    });
    again.hello();
    const { welcome } = await again.next('welcome');
    expect(welcome.resume.map((entry) => entry.action)).toEqual([
      Resume_Action.ACTION_CONTINUE,
      Resume_Action.ACTION_CONTINUE,
    ]);
    // the outbox: the run's last message again (already applied), then the rest
    again.send({
      $case: 'cases',
      cases: {
        ref: one,
        seq: 3,
        cases: [{ position: 1, status: Status.STATUS_AC, points: 1, total: 1 }],
      },
    } as never);
    const oneFinal = again.final(one, Outcome.OUTCOME_GRADED);
    again.started(two, 1);
    again.cases(two, [
      { position: 1, status: Status.STATUS_WA, points: 0, total: 1 },
    ]);
    const twoFinal = again.final(two, Outcome.OUTCOME_GRADED);
    await again.ackOf(one, oneFinal);
    await again.ackOf(two, twoFinal);
    expect(await submissionRow(first)).toMatchObject({
      status: 'D',
      result: 'AC',
      requeueCount: 0,
    });
    expect(await submissionRow(second)).toMatchObject({
      status: 'D',
      result: 'WA',
      requeueCount: 0,
    });
    for (const id of [first, second])
      expect((await submissionRow(id)).cases).toHaveLength(1);
    const jobs = (await bridge.gradedJobs()).filter((job) =>
      [first, second].includes(job.submissionId),
    );
    expect(jobs).toHaveLength(2);
    await again.close();
  });

  it('keeps a run its judge resumed after a restart through several resync ticks, then finishes it', async () => {
    await seedJudge(bridge, 'restart-20', KEY);
    const id = await seedOne();
    await commands.judge([id]);
    const judge = await connect('restart-20');
    const ref = (await judge.nextAssign()).ref!;
    judge.accept(ref);
    judge.started(ref, 1);
    await judge.ackOf(ref, 2);
    await bridge.restart();
    await judge.closed;
    const again = FakeJudge.open(bridge.judgePort(), {
      name: 'restart-20',
      key: KEY,
      inFlight: [{ ref, lastSeqSent: 2 }],
    });
    again.hello();
    await again.next('welcome');
    await sleep(1200); // four ticks: a resumed run is held, never stranded
    expect(again.seen('abort')).toEqual([]);
    expect(await submissionRow(id)).toMatchObject({
      status: 'G',
      requeueCount: 0,
      judgeGeneration: ref.generation,
    });
    again.cases(ref, [
      { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
    ]);
    await again.ackOf(ref, again.final(ref, Outcome.OUTCOME_GRADED));
    expect(await submissionRow(id)).toMatchObject({
      status: 'D',
      result: 'AC',
    });
    await again.close();
  });

  it('requeues, two resync ticks after a start and without spending the requeue, a run no judge resumed, and announces it', async () => {
    const recorder = await recordSubmissionEvents(TEST_REDIS_URL);
    try {
      const id = await seedOne({
        status: 'G',
        judgedOn: 'gone',
        judgeGeneration: 1,
        judgeSeq: 3,
      });
      await bridge.restart();
      expect((await submissionRow(id)).status).toBe('G');
      await recorder.waitFor((events) =>
        events.some(
          (event) => event.submissionId === id && event.type === 'queued',
        ),
      );
      expect(await submissionRow(id)).toMatchObject({
        status: 'QU',
        judgedOn: null,
        requeueCount: 0,
        judgeSeq: 0,
        judgeGeneration: 1,
      });
    } finally {
      await recorder.stop();
    }
  });

  it('does not requeue a run on the first tick that finds it unheld, only on the second', async () => {
    const id = await seedOne({
      status: 'G',
      judgedOn: 'gone',
      judgeGeneration: 1,
      judgeSeq: 3,
    });
    await bridge.restart({ resyncMs: 1000, resumeGraceMs: 30_000 });
    try {
      await sleep(1500); // one tick has passed (at 1000 ms), the second is due at 2000 ms
      expect((await submissionRow(id)).status).toBe('G');
      await waitUntil(async () => (await submissionRow(id)).status === 'QU');
    } finally {
      await bridge.restart({ resyncMs: 300, resumeGraceMs: 30_000 });
    }
  });

  it('marks judges a crashed bridge left online as offline', async () => {
    await seedJudge(bridge, 'restart-ghost', KEY, {
      online: true,
      ping: 0.1,
      load: 0.5,
      busy: 2,
    });
    await bridge.restart();
    expect(
      await bridge.judges.findOne({ name: 'restart-ghost' }).lean(),
    ).toMatchObject({
      online: false,
      ping: null,
      load: null,
      busy: 0,
    });
  });

  it('rebuilds the queue in priority, then age order', async () => {
    await seedJudge(bridge, 'restart-2', KEY);
    const batch = await seedOne({ priority: 3 });
    const normal = await seedOne({ priority: 1 });
    const rejudge = await seedOne({ priority: 2 });
    await bridge.restart();
    const judge = await connect('restart-2');
    for (const expected of [normal, rejudge, batch]) {
      const ref = (await judge.nextAssign()).ref!;
      expect(ref.submissionId).toBe(expected);
      judge.accept(ref);
      judge.final(ref, Outcome.OUTCOME_COMPILE_ERROR, { log: 'stop' });
    }
    await waitUntil(async () => (await submissionRow(batch)).status === 'CE');
    await judge.close();
  });

  it('dispatches a queued submission that no command announced', async () => {
    await seedJudge(bridge, 'restart-3', KEY);
    const judge = await connect('restart-3');
    const id = await seedOne();
    expect((await judge.nextAssign(3000)).ref?.submissionId).toBe(id);
    await judge.close();
  });

  it('keeps a waiting submission queued once while the judge’s slot is busy, across resync ticks', async () => {
    await seedJudge(bridge, 'restart-4', KEY);
    const judge = await connect('restart-4');
    const first = await seedOne();
    const second = await seedOne();
    const firstRef = (await judge.nextAssign(3000)).ref!;
    expect(firstRef.submissionId).toBe(first);
    judge.accept(firstRef);
    await sleep(1000);
    expect(judge.seen('assign')).toEqual([]);
    expect(
      bridge.module
        .get(DispatcherService)
        .queuedIds()
        .filter((id) => id === second),
    ).toEqual([second]);
    judge.final(firstRef, Outcome.OUTCOME_COMPILE_ERROR, { log: 'x' });
    const secondRef = (await judge.nextAssign()).ref!;
    expect(secondRef.submissionId).toBe(second);
    judge.accept(secondRef);
    await sleep(1000);
    expect(await submissionRow(second)).toMatchObject({
      status: 'P',
      requeueCount: 0,
      judgeSeq: 1,
    });
    await judge.close();
  });

  it('survives a failed resync and recovers on the next tick', async () => {
    await seedJudge(bridge, 'restart-5', KEY);
    const judge = await connect('restart-5');
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const loadQueued = jest
      .spyOn(bridge.module.get(SubmissionsRepository), 'loadQueued')
      .mockRejectedValue(new Error('mongo down'));
    try {
      await waitUntil(() => loadQueued.mock.calls.length >= 2);
      const id = await seedOne();
      expect(judge.seen('assign')).toEqual([]);
      loadQueued.mockRestore();
      expect((await judge.nextAssign(3000)).ref?.submissionId).toBe(id);
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('mongo down'),
      );
    } finally {
      loadQueued.mockRestore();
      logged.mockRestore();
    }
    await judge.close();
  });

  it('leaves finished submissions alone across a restart', async () => {
    const [graded, aborted, failed] = [
      await seedOne({ status: 'D' }),
      await seedOne({ status: 'AB' }),
      await seedOne({ status: 'CE' }),
    ];
    await bridge.restart();
    for (const [id, expected] of [
      [graded, 'D'],
      [aborted, 'AB'],
      [failed, 'CE'],
    ])
      expect(await submissionRow(id)).toMatchObject({ status: expected });
  });

  it('hands a P/G row no judge holds to a connected judge without spending the requeue', async () => {
    await seedJudge(bridge, 'restart-7', KEY);
    const judge = await connect('restart-7');
    const id = await seedOne({
      status: 'G',
      judgedOn: 'ghost',
      judgeGeneration: 4,
    });
    const ref = (await judge.nextAssign(3000)).ref!;
    expect(ref).toEqual({ submissionId: id, generation: 5 });
    expect(await submissionRow(id)).toMatchObject({
      judgedOn: 'restart-7',
      requeueCount: 0,
    });
    await judge.close();
  });

  it('never requeues a row a connected judge holds, running or in a claim', async () => {
    await seedJudge(bridge, 'restart-8', KEY);
    const repository = bridge.module.get(SubmissionsRepository);
    const claimRun = repository.claimRun.bind(repository);
    const slowClaim = jest
      .spyOn(repository, 'claimRun')
      .mockImplementation(async (...args) => {
        const outcome = await claimRun(...args);
        await sleep(1000);
        return outcome;
      });
    try {
      const judge = await connect('restart-8');
      const id = await seedOne();
      await waitUntil(async () => (await submissionRow(id)).status === 'P');
      // claimed in Mongo, Assign not sent yet: several ticks pass
      await sleep(900);
      expect(await submissionRow(id)).toMatchObject({
        status: 'P',
        judgedOn: 'restart-8',
      });
      const ref = (await judge.nextAssign()).ref!;
      slowClaim.mockRestore();
      judge.accept(ref);
      judge.started(ref, 1);
      await sleep(1000);
      expect(await submissionRow(id)).toMatchObject({
        status: 'G',
        judgedOn: 'restart-8',
        judgeGeneration: ref.generation,
      });
      expect(judge.isClosed).toBe(false);
      await judge.close();
    } finally {
      slowClaim.mockRestore();
    }
  });

  it('ignores the old run of a judge that reconnects without resuming it, and grades the new generation', async () => {
    await seedJudge(bridge, 'restart-9', KEY);
    const id = await seedOne();
    const first = await connect('restart-9');
    const old = (await first.nextAssign(3000)).ref!;
    first.accept(old);
    first.started(old, 1);
    await first.ackOf(old, 2);
    await bridge.restart();
    await first.closed;
    const judge = await connect('restart-9');
    const fresh = (await judge.nextAssign(3000)).ref!;
    expect(fresh).toEqual({ submissionId: id, generation: old.generation + 1 });
    // the old run's tail arrives on the new session
    judge.send({
      $case: 'final',
      final: {
        ref: old,
        seq: 3,
        outcome: Outcome.OUTCOME_GRADED,
        log: '',
        reason: 0,
        dataVersionUsed: 0,
      },
    });
    expect((await judge.next('abort')).abort.ref).toEqual(old);
    await judge.grade(fresh, [
      { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
    ]);
    expect(await submissionRow(id)).toMatchObject({
      status: 'D',
      requeueCount: 0,
      judgeGeneration: fresh.generation,
    });
    expect(judge.isClosed).toBe(false);
    await judge.close();
  });

  it('a second bridge on the judge port dies before touching Mongo', async () => {
    await seedJudge(bridge, 'restart-10', KEY);
    const judge = await connect('restart-10');
    const id = await seedOne();
    const ref = (await judge.nextAssign(3000)).ref!;
    judge.accept(ref);
    judge.started(ref, 1);
    await waitUntil(async () => (await submissionRow(id)).status === 'G');
    process.env.JUDGE_BRIDGE_PORT = String(bridge.judgePort());
    const contender = await Test.createTestingModule({
      imports: [BridgeModule],
    }).compile();
    try {
      await expect(contender.init()).rejects.toThrow(/EADDRINUSE/);
    } finally {
      process.env.JUDGE_BRIDGE_PORT = '0';
      // a failed init surfaces its error again when closed
      await contender.close().catch(() => undefined);
    }
    expect(await submissionRow(id)).toMatchObject({
      status: 'G',
      judgedOn: 'restart-10',
    });
    expect(
      (await bridge.judges.findOne({ name: 'restart-10' }).lean())?.online,
    ).toBe(true);
    await judge.close();
  });

  it('keeps a submission targeted at a busy judge for it across resync ticks', async () => {
    await seedJudge(bridge, 'restart-16', KEY);
    await seedJudge(bridge, 'restart-17', KEY);
    const busy = await connect('restart-16');
    const free = await connect('restart-17');
    const first = await seedOne({ status: 'PD' });
    await bridge.submissions.updateOne(
      { _id: first },
      { $set: { status: 'QU' } },
    );
    await commands.judge([first], 'restart-16');
    const firstRef = (await busy.nextAssign()).ref!;
    expect(firstRef.submissionId).toBe(first);
    busy.accept(firstRef);
    const targeted = await seedOne({ status: 'PD' });
    await bridge.submissions.updateOne(
      { _id: targeted },
      { $set: { status: 'QU' } },
    );
    await commands.judge([targeted], 'restart-16');
    await sleep(1000);
    expect(free.seen('assign')).toEqual([]);
    busy.final(firstRef, Outcome.OUTCOME_COMPILE_ERROR, { log: 'x' });
    expect((await busy.nextAssign()).ref?.submissionId).toBe(targeted);
    await busy.close();
    await free.close();
  });

  describe('a judge change whose command was lost', () => {
    it('disconnects a judge blocked in Mongo within a tick, and it grades nothing more', async () => {
      await seedJudge(bridge, 'restart-11', KEY);
      const judge = await connect('restart-11');
      await bridge.judges.updateOne(
        { name: 'restart-11' },
        { isBlocked: true },
      );
      expect((await judge.closed).code).toBe(status.PERMISSION_DENIED);
      const id = await seedOne();
      await sleep(1000);
      expect(judge.seen('assign')).toEqual([]);
      expect(await submissionRow(id)).toMatchObject({ status: 'QU' });
    });

    it('disconnects a judge whose key was rotated or row deleted in Mongo, and keeps one whose row is unchanged', async () => {
      for (const name of ['restart-12', 'restart-13', 'restart-18'])
        await seedJudge(bridge, name, KEY);
      const rotated = await connect('restart-12');
      const kept = await connect('restart-13');
      const deleted = await connect('restart-18');
      await bridge.judges.deleteOne({ name: 'restart-18' });
      await deleted.closed;
      await bridge.judges.updateOne(
        { name: 'restart-12' },
        { authKeyHash: sha256('another key') },
      );
      await rotated.closed;
      expect(kept.isClosed).toBe(false);
      await kept.close();
    });

    it('applies a disable and an enable made in Mongo to a connected judge', async () => {
      await seedJudge(bridge, 'restart-14', KEY);
      const judge = await connect('restart-14');
      await bridge.judges.updateOne(
        { name: 'restart-14' },
        { isDisabled: true },
      );
      await sleep(1000);
      const id = await seedOne();
      await sleep(1000);
      expect(judge.seen('assign')).toEqual([]);
      await bridge.judges.updateOne(
        { name: 'restart-14' },
        { isDisabled: false },
      );
      expect((await judge.nextAssign(3000)).ref?.submissionId).toBe(id);
      await judge.close();
    });
  });

  it('marks its judges offline when it stops, while a run they hold stays P/G', async () => {
    await seedJudge(bridge, 'restart-15', KEY);
    const stopping = await Test.createTestingModule({
      imports: [BridgeModule],
    }).compile();
    await stopping.init();
    const judge = await FakeJudge.online(stopping.get(JudgeLinkServer).port(), {
      name: 'restart-15',
      key: KEY,
    });
    const id = await seedOne({ status: 'PD' });
    await bridge.submissions.updateOne({ _id: id }, { $set: { status: 'QU' } });
    await commands.judge([id], 'restart-15');
    await judge.nextAssign();
    await stopping.close();
    expect((await judge.closed).code).toBe(status.UNAVAILABLE);
    expect(
      (await bridge.judges.findOne({ name: 'restart-15' }).lean())?.online,
    ).toBe(false);
    expect(await submissionRow(id)).toMatchObject({ status: 'P' });
  });
});
