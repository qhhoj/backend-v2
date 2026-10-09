import Redis from 'ioredis';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { Case, Final, Outcome, Status } from '@libs/judge-proto';
import type { Assign } from '@libs/judge-proto';
import { BridgeCommandsService } from '@libs/judging';
import { RETRY_LIMIT_MESSAGE } from '../src/submissions/run-writes.repository';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const AC = Status.STATUS_AC;
const WA = Status.STATUS_WA;

describe('Grading through the judge link (results written for what a judge sends)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const judges: FakeJudge[] = [];
  let counter = 0;

  /** A judge row and an online judge of its own (one live session per judge). */
  const online = async (): Promise<FakeJudge> => {
    const name = `grading-${(counter += 1)}`;
    await seedJudge(bridge, name, `${name}-key`);
    const judge = await FakeJudge.online(bridge.judgePort(), {
      name,
      key: `${name}-key`,
    });
    judges.push(judge);
    return judge;
  };
  /** Queues a new submission of a new problem; the judges online get it. */
  const submit = async (problemFields = {}): Promise<string> => {
    const problem = await seedProblem(bridge, catalog, {
      code: `grading${(counter += 1)}`,
      ...problemFields,
    });
    const { _id } = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    await commands.judge([_id]);
    return _id;
  };
  const stored = async (id: string) =>
    (await bridge.submissions.findById(id).select('+cases').lean())!;
  const jobIds = async () =>
    (await bridge.graded.getJobs(['waiting'])).map((job) => job.id);
  const ackSeqs = (judge: FakeJudge) =>
    judge.seen('ack').map(({ ack }) => ack.seq);
  /** The first of `candidates` that is handed an Assign. */
  const holder = async (candidates: FakeJudge[]): Promise<FakeJudge> => {
    await waitUntil(() =>
      candidates.some((judge) => judge.seen('assign').length > 0),
    );
    return candidates.find((judge) => judge.seen('assign').length > 0)!;
  };
  const sentFinal = (judge: FakeJudge, assign: Assign, seq: number) =>
    judge.send({
      $case: 'final',
      final: Final.fromPartial({
        ref: assign.ref,
        seq,
        outcome: Outcome.OUTCOME_GRADED,
      }),
    });

  beforeAll(async () => {
    // the suite is about results, not the accept clock: a loaded host must not release a slow Accepted
    bridge = await setupBridgeTest({ timings: { acceptMs: 10_000 } });
    catalog = await seedCatalog(bridge);
  });
  // judges see every problem: nothing a test leaves queued or running may reach the next test's judge
  afterEach(async () => {
    await bridge.submissions.updateMany(
      { status: { $in: ['QU', 'P', 'G'] } },
      { $set: { status: 'AB', result: 'AB' } },
    );
    await Promise.all(judges.splice(0).map((judge) => judge.close()));
    await bridge.graded.obliterate({ force: true });
  });
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  it('grades the cases a judge reports: worst status, summed points, slowest time, largest memory, one graded job, every message acked', async () => {
    const judge = await online();
    const id = await submit({ points: 1000, partial: true });
    const assign = await judge.nextAssign();
    await judge.grade(assign.ref!, [
      {
        position: 1,
        status: AC,
        points: 1,
        total: 1,
        timeS: 0.1,
        memoryKib: 100,
      },
      {
        position: 2,
        status: WA,
        points: 0,
        total: 1,
        timeS: 0.4,
        memoryKib: 50,
      },
      {
        position: 3,
        status: AC,
        points: 1,
        total: 1,
        timeS: 0.2,
        memoryKib: 300,
      },
    ]);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'WA',
      casePoints: 2,
      caseTotal: 3,
      points: 666.667,
      time: 0.4,
      memory: 300,
      judgeSeq: 4,
    });
    expect((await stored(id)).cases.map((row) => row.status)).toEqual([
      'AC',
      'WA',
      'AC',
    ]);
    expect(ackSeqs(judge)).toEqual([1, 2, 3, 4]);
    expect(await jobIds()).toEqual([`${id}.1`]);
  });

  it('scores a partial problem by the fractions in the cases (points 0..1 of total 1) and zeroes a non-partial one short of full marks', async () => {
    const judge = await online();
    const fractions = [
      { position: 1, status: AC, points: 0.5, total: 1 },
      { position: 2, status: AC, points: 1, total: 1 },
    ];
    const partial = await submit({ points: 1000, partial: true });
    await judge.grade((await judge.nextAssign()).ref!, fractions);
    const all = await submit({ points: 1000, partial: false });
    await judge.grade((await judge.nextAssign()).ref!, fractions);
    const full = await submit({ points: 1000, partial: false });
    await judge.grade((await judge.nextAssign()).ref!, [
      { position: 1, status: AC, points: 1, total: 1 },
    ]);
    expect(await stored(partial)).toMatchObject({
      status: 'D',
      casePoints: 1.5,
      caseTotal: 2,
      points: 750,
    });
    expect((await stored(all)).points).toBe(0);
    expect((await stored(full)).points).toBe(1000);
  });

  it('ends a compile error as CE with the compiler log, and an internal error as IE with its message, each with one graded job', async () => {
    const judge = await online();
    const ce = await submit();
    const ceRef = (await judge.nextAssign()).ref!;
    judge.accept(ceRef);
    await judge.ackOf(
      ceRef,
      judge.final(ceRef, Outcome.OUTCOME_COMPILE_ERROR, { log: 'no main' }),
    );
    const ie = await submit();
    const ieRef = (await judge.nextAssign()).ref!;
    judge.accept(ieRef);
    await judge.ackOf(
      ieRef,
      judge.final(ieRef, Outcome.OUTCOME_INTERNAL_ERROR, { log: 'disk full' }),
    );
    expect(await stored(ce)).toMatchObject({
      status: 'CE',
      result: 'CE',
      error: 'no main',
    });
    expect(await stored(ie)).toMatchObject({
      status: 'IE',
      result: 'IE',
      error: 'disk full',
    });
    expect((await jobIds()).sort()).toEqual([`${ce}.1`, `${ie}.1`].sort());
  });

  it('requeues a RETRY for another judge without spending the requeue, and ends the third RETRY as IE', async () => {
    const first = await online();
    const second = await online();
    const id = await submit();
    const attempts: FakeJudge[] = [];
    for (const generation of [1, 2, 3]) {
      const judge = await holder(
        attempts.length
          ? [attempts.at(-1) === first ? second : first]
          : [first, second],
      );
      const assign = await judge.nextAssign();
      expect(assign.ref).toMatchObject({ submissionId: id, generation });
      judge.accept(assign.ref!);
      await judge.ackOf(
        assign.ref!,
        judge.final(assign.ref!, Outcome.OUTCOME_RETRY, {
          log: `try ${generation}`,
        }),
      );
      attempts.push(judge);
    }
    expect(await stored(id)).toMatchObject({
      status: 'IE',
      result: 'IE',
      retryCount: 3,
      requeueCount: 0,
      error: `${RETRY_LIMIT_MESSAGE}: try 3`,
    });
    expect(await jobIds()).toEqual([`${id}.3`]);
  });

  it('stores judgeSeq as the last message stored, and ends a session that skips a seq without storing that message', async () => {
    const judge = await online();
    const id = await submit();
    const ref = (await judge.nextAssign()).ref!;
    judge.accept(ref);
    judge.started(ref, 2);
    judge.cases(ref, [{ position: 1, status: AC, points: 1, total: 1 }]);
    await judge.ackOf(ref, 3);
    expect(await stored(id)).toMatchObject({ status: 'G', judgeSeq: 3 });
    const skipped = judge.nextSeq(ref) + 1;
    judge.send({
      $case: 'cases',
      cases: {
        ref,
        seq: skipped,
        cases: [
          Case.fromPartial({ position: 2, status: AC, points: 1, total: 1 }),
        ],
      },
    });
    await judge.closed;
    const row = await stored(id);
    expect(row).toMatchObject({ status: 'G', judgeSeq: 3 });
    expect(row.cases).toHaveLength(1);
  });

  it('acks a Final sent twice again and writes it once: one graded job, the stored result untouched', async () => {
    const judge = await online();
    const id = await submit({ points: 1000, partial: true });
    const assign = await judge.nextAssign();
    const ref = assign.ref!;
    await judge.grade(ref, [{ position: 1, status: AC, points: 1, total: 1 }]);
    const before = await stored(id);
    sentFinal(judge, assign, judge.nextSeq(ref) - 1);
    await waitUntil(
      () =>
        ackSeqs(judge).filter((seq) => seq === before.judgeSeq).length === 2,
    );
    expect(await stored(id)).toEqual(before);
    expect(await jobIds()).toEqual([`${id}.1`]);
    expect(judge.seen('abort')).toEqual([]);
  });

  it('ignores a Final for a run that moved on (the row was finished elsewhere): not acked, not written, the judge told to abort', async () => {
    const judge = await online();
    const id = await submit({ points: 1000 });
    const assign = await judge.nextAssign();
    const ref = assign.ref!;
    judge.accept(ref);
    judge.started(ref, 1);
    await judge.ackOf(ref, 2);
    await bridge.submissions.updateOne(
      { _id: id },
      { $set: { status: 'AB', result: 'AB', points: 0 } },
    );
    sentFinal(judge, assign, judge.nextSeq(ref));
    await judge.next('abort');
    expect(ackSeqs(judge)).toEqual([1, 2]);
    expect(await stored(id)).toMatchObject({ status: 'AB', points: 0 });
    expect(await jobIds()).toEqual([]);
  });

  it("ignores another judge's Final for a run it does not hold, and the run goes on to its own judge", async () => {
    const owner = await online();
    const other = await online();
    const id = await submit({ points: 1000 });
    const holding = await holder([owner, other]);
    const bystander = holding === owner ? other : owner;
    const assign = await holding.nextAssign();
    sentFinal(bystander, assign, 1);
    await bystander.next('abort');
    expect(bystander.seen('ack')).toEqual([]);
    expect(await stored(id)).toMatchObject({ status: 'P', judgeSeq: 0 });
    await holding.grade(assign.ref!, [
      { position: 1, status: AC, points: 1, total: 1 },
    ]);
    expect(await stored(id)).toMatchObject({ status: 'D', points: 1000 });
  });
});
