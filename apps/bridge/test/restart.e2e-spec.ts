import { status } from '@grpc/grpc-js';
import { Test } from '@nestjs/testing';
import type { Submission } from '@libs/database';
import Redis from 'ioredis';
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
import { countResyncTicks, resyncTicks } from './resync-ticks';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const KEY = 'restart key';
/** Ticks every 300 ms; a judge here always accepts, so a loaded machine must not turn a slow Accepted into an accept timeout. */
const TIMINGS = { resyncMs: 300, resumeGraceMs: 30_000, acceptMs: 10_000 };

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
    countResyncTicks();
    bridge = await setupBridgeTest({
      timings: TIMINGS,
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
    jest.restoreAllMocks();
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
    // two claims can be in flight at once (the command and a resync tick), so the Assigns may come in either order
    const refs = [
      (await judge.nextAssign()).ref!,
      (await judge.nextAssign()).ref!,
    ];
    const [one, two] = [first, second].map((id) =>
      refs.find((ref) => ref.submissionId === id)!,
    );
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

  it('dispatches a queued submission that no command announced', async () => {
    await seedJudge(bridge, 'restart-3', KEY);
    const judge = await connect('restart-3');
    const id = await seedOne();
    expect((await judge.nextAssign(3000)).ref?.submissionId).toBe(id);
    await judge.close();
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
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slowClaim = jest
      .spyOn(repository, 'claimRun')
      .mockImplementation(async (...args) => {
        const outcome = await claimRun(...args);
        await held;
        return outcome;
      });
    try {
      const id = await seedOne();
      // queued in memory with no judge, so the claim runs in the judge's registration, not in a tick
      await waitUntil(() => bridge.module.get(DispatcherService).hasQueued(id));
      const judge = await connect('restart-8');
      await waitUntil(async () => (await submissionRow(id)).status === 'P');
      // claimed in Mongo, Assign not sent yet: several ticks pass
      await resyncTicks(3);
      expect(await submissionRow(id)).toMatchObject({
        status: 'P',
        judgedOn: 'restart-8',
      });
      release();
      const ref = (await judge.nextAssign()).ref!;
      slowClaim.mockRestore();
      judge.accept(ref);
      judge.started(ref, 1);
      await resyncTicks(3);
      expect(await submissionRow(id)).toMatchObject({
        status: 'G',
        judgedOn: 'restart-8',
        judgeGeneration: ref.generation,
      });
      expect(judge.isClosed).toBe(false);
      await judge.close();
    } finally {
      release();
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
    const first = await seedOne({ status: 'PD', pinnedJudge: 'restart-16' });
    await bridge.submissions.updateOne(
      { _id: first },
      { $set: { status: 'QU' } },
    );
    await commands.judge([first], 'restart-16');
    const firstRef = (await busy.nextAssign()).ref!;
    expect(firstRef.submissionId).toBe(first);
    busy.accept(firstRef);
    // the api stores the pin with the row, so a tick that reads it before the command keeps it too
    const targeted = await seedOne({
      status: 'PD',
      pinnedJudge: 'restart-16',
    });
    await bridge.submissions.updateOne(
      { _id: targeted },
      { $set: { status: 'QU' } },
    );
    await commands.judge([targeted], 'restart-16');
    await resyncTicks(3);
    expect(free.seen('assign')).toEqual([]);
    busy.final(firstRef, Outcome.OUTCOME_COMPILE_ERROR, { log: 'x' });
    expect((await busy.nextAssign()).ref?.submissionId).toBe(targeted);
    await busy.close();
    await free.close();
  });

  describe('a judge change whose command was lost', () => {
    it('applies a disable and an enable made in Mongo to a connected judge', async () => {
      await seedJudge(bridge, 'restart-14', KEY);
      const judge = await connect('restart-14');
      await bridge.judges.updateOne(
        { name: 'restart-14' },
        { isDisabled: true },
      );
      // a tick under way may have read the row before the update
      await resyncTicks(2);
      const id = await seedOne();
      await resyncTicks(2);
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
