import { Logger } from '@nestjs/common';
import { newId } from '@libs/database';
import { Resume_Action } from '@libs/judge-proto';
import type { AssignmentRef } from '@libs/judge-proto';
import { DEFAULT_BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import type { AssignRequest } from '../submissions/assign-request';
import type { RunsService } from '../submissions/runs.service';
import type { SubmissionsRepository } from '../submissions/submissions.repository';
import { DispatcherService } from './dispatcher.service';
import type { DispatchTarget, QueuedSubmission } from './slots';

/** A session without a stream: records what the dispatcher tells it. */
class Target implements DispatchTarget {
  readonly id = newId();
  readonly inFlight = new Map<string, number>();
  readonly winding = new Set<string>();
  readonly settling = new Set<string>();
  readonly generations = new Set<string>();
  features: ReadonlySet<string> = new Set();
  build = 'test';
  executors: ReadonlySet<string> = new Set(['CPP17']);
  isDisabled = false;
  isDraining = false;
  isClosed = false;
  authKeyHash = 'hash';
  readonly assigned: AssignRequest[] = [];
  readonly aborted: AssignmentRef[] = [];
  wasReplaced = false;
  constructor(
    readonly name: string,
    public slots = 1,
  ) {}
  assign(request: AssignRequest): void {
    this.assigned.push(request);
  }
  abort(ref: AssignmentRef): void {
    this.aborted.push(ref);
  }
  generate(): void {}
  cancelGeneration(): void {}
  disconnect(): void {
    this.isClosed = true;
  }
  /** A replaced `JudgeSession` ends its stream at once. */
  replaced(): void {
    this.wasReplaced = true;
    this.isClosed = true;
  }
}

/** The generation queue is empty and holds nothing here; its own spec covers it. */
const NO_GENERATIONS = {
  hasQueuedFor: () => false,
  judgeLost: () => Promise.resolve(),
  stop: () => undefined,
} as never;

const TIMINGS = {
  resumeGraceMs: 30_000,
  runMarginMs: 60_000,
  runCaseBudget: 10,
} as BridgeTimings;
/** Deadline of a run with the stand-in claim's 2 s time limit. */
const RUN_DEADLINE_MS = 60_000 + 2 * 1000 * 10;
const entry = (fields: Partial<QueuedSubmission> = {}): QueuedSubmission => ({
  id: newId(),
  problemCode: 'sum',
  languageKey: 'CPP17',
  priority: 1,
  generation: 0,
  judgeName: null,
  bannedJudges: [],
  retryBannedJudges: [],
  requiredFeatures: [],
  refusedBy: [],
  retryAfter: 0,
  waitsForData: false,
  ...fields,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('DispatcherService', () => {
  /** Mongo stand-in: the generation of every row, bumped by each claim. */
  let generations: Map<string, number>;
  let rows: Map<string, QueuedSubmission>;
  let stored: Map<string, number | null>;
  /** `resumableSeq` of these submissions waits on their promise: a handshake held open mid-resume. */
  let resumeGates: Map<string, Promise<void>>;
  /** When set, every claim waits on it: a dispatch held open between its read and its claim. */
  let claimGate: Promise<void> | null;
  let tracked: Set<string>;
  /** Submissions a release announced as `queued`. */
  let published: string[];
  let expired: Array<{ ref: AssignmentRef; abortRequested: boolean }>;
  /** When set, requeuing a run whose Final was not stored fails (Mongo still down). */
  let requeueFails: boolean;
  let dispatcher: DispatcherService;
  const runs = {
    /** Mongo's compare-and-set: a row read before a later claim is no longer QU at that generation, so the claim misses. */
    claim: async (queued: QueuedSubmission) => {
      await claimGate;
      if ((generations.get(queued.id) ?? 0) !== queued.generation) return null;
      const generation = queued.generation + 1;
      generations.set(queued.id, generation);
      return {
        request: {
          ref: { submissionId: queued.id, generation },
          timeLimit: 2,
        } as AssignRequest,
        subject: { submissionId: queued.id, userId: 'u', problemId: 'p' },
      };
    },
    /** RunsService's tracking: a release publishes `queued` only for a run still tracked. */
    sent: ({ request }: { request: AssignRequest }) =>
      void tracked.add(request.ref.submissionId),
    forget: (ref: AssignmentRef) => void tracked.delete(ref.submissionId),
    release: (ref: AssignmentRef) => {
      if (tracked.delete(ref.submissionId)) published.push(ref.submissionId);
      return Promise.resolve(true);
    },
    requeueUnstored: () =>
      requeueFails
        ? Promise.reject(new Error('Mongo down'))
        : Promise.resolve(true),
    resumableSeq: async (ref: AssignmentRef) => {
      await resumeGates.get(ref.submissionId);
      return stored.get(`${ref.submissionId}.${ref.generation}`) ?? null;
    },
    graceExpired: (
      ref: AssignmentRef,
      _judge: string,
      abortRequested: boolean,
    ) => {
      expired.push({ ref, abortRequested });
      return Promise.resolve(abortRequested ? 'aborted' : 'requeued');
    },
  } as unknown as RunsService;
  const submissions = {
    loadQueued: (ids: string[]) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const row = rows.get(id);
          return row ? [{ ...row, generation: generations.get(id) ?? 0 }] : [];
        }),
      ),
  } as unknown as SubmissionsRepository;
  const queue = async (...entries: QueuedSubmission[]) => {
    for (const queued of entries) rows.set(queued.id, queued);
    await dispatcher.enqueue(entries);
  };
  const online = async (target: Target) => {
    await dispatcher.resume(target, []);
    await dispatcher.register(target);
    return target;
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    generations = new Map();
    rows = new Map();
    stored = new Map();
    resumeGates = new Map();
    claimGate = null;
    tracked = new Set();
    published = [];
    expired = [];
    requeueFails = false;
    dispatcher = new DispatcherService(
      submissions,
      runs,
      NO_GENERATIONS,
      TIMINGS,
    );
  });
  afterEach(() => {
    dispatcher.stop();
    jest.useRealTimers();
  });

  it('fills the least busy judge slot by slot, and queues what no slot can take', async () => {
    const big = await online(new Target('big', 2));
    const small = await online(new Target('small', 1));
    const [first, second, third, fourth] = [entry(), entry(), entry(), entry()];
    await queue(first, second, third, fourth);
    expect(big.assigned).toHaveLength(2);
    expect(small.assigned).toHaveLength(1);
    expect(dispatcher.queuedIds()).toEqual([fourth.id]);
    expect(dispatcher.heldIds().sort()).toEqual(
      [first.id, second.id, third.id].sort(),
    );
  });

  it('voids a run when its row is rejudged: the judge is told to stop and the new generation is assigned', async () => {
    // three slots: the winding run keeps one, and a rejudge never takes the last free one
    const judge = await online(new Target('j1', 3));
    const submission = entry();
    await queue(submission);
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1,
    ]);
    await queue({ ...submission, priority: 2, generation: 1 });
    expect(judge.aborted).toEqual([
      { submissionId: submission.id, generation: 1 },
    ]);
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
    expect(judge.inFlight.get(submission.id)).toBe(2);
    expect([...judge.winding]).toEqual([`${submission.id}.1`]);
  });

  it('keeps a voided run’s slot until the judge’s Final for it (one slot: the new generation waits)', async () => {
    const judge = await online(new Target('j1', 1));
    const submission = entry();
    await queue(submission);
    await queue({ ...submission, priority: 2, generation: 1 });
    expect(judge.aborted).toEqual([
      { submissionId: submission.id, generation: 1 },
    ]);
    expect(judge.assigned).toHaveLength(1);
    expect(dispatcher.queuedIds()).toEqual([submission.id]);
    await dispatcher.windingEnded(judge, {
      submissionId: submission.id,
      generation: 1,
    });
    expect(judge.winding.size).toBe(0);
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
    await dispatcher.windingEnded(judge, {
      submissionId: submission.id,
      generation: 1,
    });
    expect(judge.assigned).toHaveLength(2);
    judge.winding.add('stale.1');
    await dispatcher.judgeLost(judge);
    expect(judge.winding.size).toBe(0);
  });

  it('never re-dispatches a run a judge holds when resync ticks interleave with its dispatch (a two-slot judge)', async () => {
    const judge = await online(new Target('j1', 2));
    const submission = entry();
    rows.set(submission.id, submission);
    let open: () => void = () => undefined;
    claimGate = new Promise((resolve) => (open = resolve));
    // tick 1 reads the row QU at generation 0, and its enqueue starts a dispatch whose claim is still in Mongo
    const dispatching = dispatcher.enqueue([submission]);
    await flush();
    // tick 2 read the same row before that claim: it finds the claim in flight
    const secondTick = dispatcher.enqueue([{ ...submission }]);
    await flush();
    open();
    await Promise.all([dispatching, secondTick]);
    claimGate = null;
    // tick 3 read the row before the claim landed, and enqueues after it
    await dispatcher.enqueue([{ ...submission }]);
    expect(judge.assigned.map((request) => request.ref)).toEqual([
      { submissionId: submission.id, generation: 1 },
    ]);
    expect(judge.inFlight.get(submission.id)).toBe(1);
    expect(judge.aborted).toEqual([]);
    expect(dispatcher.heldIds()).toEqual([submission.id]);
    expect(dispatcher.queuedIds()).toEqual([]);
  });

  it('never dispatches over a run its judge holds, even from a queue entry left behind', async () => {
    const judge = await online(new Target('j1', 2));
    await dispatcher.setDisabled('j1', true);
    const submission = entry();
    await queue(submission);
    judge.inFlight.set(submission.id, 1);
    await dispatcher.setDisabled('j1', false);
    expect(judge.assigned).toEqual([]);
    expect(judge.inFlight.get(submission.id)).toBe(1);
  });

  it('voids a run resumed by a session still in its handshake when its row is rejudged: the Abort follows the Welcome and the new generation takes a spare slot', async () => {
    // three slots: the other resumed run is live, the voided one winds down, a rejudge never takes the last opening slot
    const judge = await online(new Target('j1', 3));
    const [rejudged, other] = [entry(), entry()];
    await queue(rejudged, other);
    await dispatcher.judgeLost(judge);
    for (const { id } of [rejudged, other]) stored.set(`${id}.1`, 1);
    let open: () => void = () => undefined;
    resumeGates.set(other.id, new Promise((resolve) => (open = resolve)));
    const back = new Target('j1', 3);
    const resuming = dispatcher.resume(
      back,
      [rejudged, other].map(({ id }) => ({
        ref: { submissionId: id, generation: 1 },
        lastSeqSent: 1,
      })),
    );
    await flush();
    await queue({ ...rejudged, priority: 2, generation: 1 });
    open();
    const plan = await resuming;
    expect(plan.abort).toEqual([{ submissionId: rejudged.id, generation: 1 }]);
    expect(back.aborted).toEqual([]);
    expect([...back.winding]).toEqual([`${rejudged.id}.1`]);
    expect(back.inFlight.has(rejudged.id)).toBe(false);
    await dispatcher.register(back);
    expect(back.assigned.map((request) => request.ref)).toEqual([
      { submissionId: rejudged.id, generation: 2 },
    ]);
    expect([...back.winding]).toEqual([`${rejudged.id}.1`]);
  });

  it('sends the Abort of a voided resumed run at once when the Welcome already went out', async () => {
    const judge = await online(new Target('j1', 2));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(judge);
    stored.set(`${submission.id}.1`, 1);
    const back = new Target('j1', 2);
    await dispatcher.resume(back, [
      { ref: { submissionId: submission.id, generation: 1 }, lastSeqSent: 1 },
    ]);
    await queue({ ...submission, priority: 2, generation: 1 });
    expect(back.aborted).toEqual([
      { submissionId: submission.id, generation: 1 },
    ]);
    expect(back.inFlight.has(submission.id)).toBe(false);
  });

  it('holds a lost judge’s runs in grace and resumes them on reconnect without a requeue', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(judge);
    expect(dispatcher.heldIds()).toEqual([submission.id]);
    stored.set(`${submission.id}.1`, 3);
    const back = new Target('j1');
    const plan = await dispatcher.resume(back, [
      { ref: { submissionId: submission.id, generation: 1 }, lastSeqSent: 3 },
    ]);
    expect(plan).toEqual({
      resume: [
        {
          ref: { submissionId: submission.id, generation: 1 },
          action: Resume_Action.ACTION_CONTINUE,
          fromSeq: 4,
        },
      ],
      abort: [],
    });
    await dispatcher.register(back);
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(expired).toEqual([]);
    expect(back.inFlight.get(submission.id)).toBe(1);
  });

  it('drops a run Mongo no longer gives the judge, and expires at once what the judge no longer lists', async () => {
    const judge = await online(new Target('j1', 2));
    const [kept, forgotten] = [entry(), entry()];
    await queue(kept, forgotten);
    await dispatcher.judgeLost(judge);
    const back = new Target('j1', 2);
    const plan = await dispatcher.resume(back, [
      { ref: { submissionId: kept.id, generation: 1 }, lastSeqSent: 1 },
    ]);
    expect(plan.resume).toEqual([
      expect.objectContaining({ action: Resume_Action.ACTION_DROP }),
    ]);
    expect([...back.winding]).toEqual([`${kept.id}.1`]);
    await flush();
    expect(expired).toEqual([
      {
        ref: { submissionId: forgotten.id, generation: 1 },
        abortRequested: false,
      },
    ]);
  });

  it('requeues a run whose judge stays away past the grace, to another judge', async () => {
    const lost = await online(new Target('lost'));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(lost);
    const other = await online(new Target('other'));
    expect(other.assigned).toEqual([]);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(expired).toEqual([
      {
        ref: { submissionId: submission.id, generation: 1 },
        abortRequested: false,
      },
    ]);
    expect(other.assigned.map((request) => request.ref)).toEqual([
      { submissionId: submission.id, generation: 2 },
    ]);
  });

  it('holds a run in grace again when its expiry write fails, so the retry still spends the requeue', async () => {
    const lost = await online(new Target('lost'));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(lost);
    const failing = jest
      .spyOn(runs, 'graceExpired')
      .mockRejectedValueOnce(new Error('mongo down'));
    try {
      jest.advanceTimersByTime(30_000);
      await flush();
      expect(dispatcher.heldIds()).toEqual([submission.id]);
    } finally {
      failing.mockRestore();
    }
    const other = await online(new Target('other'));
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(expired).toEqual([
      {
        ref: { submissionId: submission.id, generation: 1 },
        abortRequested: false,
      },
    ]);
    expect(other.assigned.map((request) => request.ref)).toEqual([
      { submissionId: submission.id, generation: 2 },
    ]);
  });

  describe('run deadline', () => {
    it('aborts a run its judge never finishes, frees nothing early, and requeues it once', async () => {
      const judge = await online(new Target('j1', 2));
      const hung = entry();
      await queue(hung);
      jest.advanceTimersByTime(RUN_DEADLINE_MS - 1);
      await flush();
      expect(judge.aborted).toEqual([]);
      jest.advanceTimersByTime(1);
      await flush();
      expect(judge.aborted).toEqual([{ submissionId: hung.id, generation: 1 }]);
      expect(expired).toEqual([
        {
          ref: { submissionId: hung.id, generation: 1 },
          abortRequested: false,
        },
      ]);
      // the slot is held until the judge's Final{ABORTED}
      expect(judge.winding.size).toBe(1);
      // requeued once: handed out again as a new generation
      expect(judge.inFlight.get(hung.id)).toBe(2);
    });

    it('ends a user-aborted run as AB when its judge never answers the abort before the deadline', async () => {
      const judge = await online(new Target('j1', 2));
      const hung = entry();
      await queue(hung);
      dispatcher.abort(hung.id);
      expect(judge.aborted).toEqual([{ submissionId: hung.id, generation: 1 }]);
      jest.advanceTimersByTime(RUN_DEADLINE_MS);
      await flush();
      expect(expired).toEqual([
        {
          ref: { submissionId: hung.id, generation: 1 },
          abortRequested: true,
        },
      ]);
      // not handed out again
      expect(judge.inFlight.has(hung.id)).toBe(false);
    });

    it('lets a legitimate long run finish under the production timings: 400 cases at the 2 s limit, each TLE at its 2.5 s cap', async () => {
      // judge-v2 runs cases one by one; a partial problem (no short-circuit) runs all of them. CPU-bound TLE stops at TL + 0.5 s.
      const CASES = 400;
      const perCaseMs = (2 + 0.5) * 1000;
      dispatcher.stop();
      dispatcher = new DispatcherService(
        submissions,
        runs,
        NO_GENERATIONS,
        DEFAULT_BRIDGE_TIMINGS,
      );
      const judge = await online(new Target('j1', 1));
      const long = entry();
      await queue(long);
      const ref = { submissionId: long.id, generation: 1 };
      dispatcher.runStarted(judge, ref, CASES);
      jest.advanceTimersByTime(CASES * perCaseMs);
      await flush();
      expect(judge.aborted).toEqual([]);
      expect(expired).toEqual([]);
      // still a deadline: 10 min + 400 × (3 × 2 + 1 + 5) s from Started
      jest.advanceTimersByTime(600_000 + CASES * 12_000 - CASES * perCaseMs);
      await flush();
      expect(judge.aborted).toEqual([ref]);
      expect(expired).toEqual([{ ref, abortRequested: false }]);
    });

    it('ignores a Started of a run its judge no longer holds', async () => {
      const judge = await online(new Target('j1', 2));
      const done = entry();
      await queue(done);
      const ref = { submissionId: done.id, generation: 1 };
      await dispatcher.runEnded(judge, ref, { retried: false });
      dispatcher.runStarted(judge, ref, 10_000);
      jest.advanceTimersByTime(RUN_DEADLINE_MS * 1000);
      await flush();
      expect(judge.aborted).toEqual([]);
      expect(expired).toEqual([]);
    });

    it('does nothing for a run that ended in time', async () => {
      const judge = await online(new Target('j1'));
      const done = entry();
      await queue(done);
      await dispatcher.runEnded(
        judge,
        { submissionId: done.id, generation: 1 },
        { retried: false },
      );
      jest.advanceTimersByTime(RUN_DEADLINE_MS * 2);
      await flush();
      expect(judge.aborted).toEqual([]);
      expect(expired).toEqual([]);
    });
  });

  it('records an abort sent during the grace: sent after a resume, AB on expiry', async () => {
    const judge = await online(new Target('j1', 2));
    const [resumed, expiring] = [entry(), entry()];
    await queue(resumed, expiring);
    await dispatcher.judgeLost(judge);
    dispatcher.abort(resumed.id);
    dispatcher.abort(expiring.id);
    stored.set(`${resumed.id}.1`, 1);
    const plan = await dispatcher.resume(new Target('j1', 2), [
      { ref: { submissionId: resumed.id, generation: 1 }, lastSeqSent: 1 },
      { ref: { submissionId: expiring.id, generation: 1 }, lastSeqSent: 1 },
    ]);
    expect(plan.abort).toEqual([{ submissionId: resumed.id, generation: 1 }]);
    expect(plan.resume[1].action).toBe(Resume_Action.ACTION_DROP);
    const fresh = new Target('j2');
    await online(fresh);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(expired).toEqual([]);
  });

  it('keeps an abort sent to a judge already gone: a resume aborts the run after the Welcome, an expiry writes AB', async () => {
    const judge = await online(new Target('j1', 2));
    const [resumed, expiring] = [entry(), entry()];
    await queue(resumed, expiring);
    // the stream died; the bridge has not handled the loss yet
    judge.isClosed = true;
    dispatcher.abort(resumed.id);
    dispatcher.abort(expiring.id);
    await dispatcher.judgeLost(judge);
    stored.set(`${resumed.id}.1`, 1);
    const plan = await dispatcher.resume(new Target('j1', 2), [
      { ref: { submissionId: resumed.id, generation: 1 }, lastSeqSent: 1 },
    ]);
    expect(plan.abort).toEqual([{ submissionId: resumed.id, generation: 1 }]);
    expect(expired).toEqual([
      {
        ref: { submissionId: expiring.id, generation: 1 },
        abortRequested: true,
      },
    ]);
  });

  it('keeps an abort waiting for the Welcome of a handshake that dies before sending it', async () => {
    const judge = await online(new Target('j1', 2));
    const [resumed, waiting] = [entry(), entry()];
    await queue(resumed, waiting);
    await dispatcher.judgeLost(judge);
    for (const { id } of [resumed, waiting]) stored.set(`${id}.1`, 1);
    let open: () => void = () => undefined;
    resumeGates.set(waiting.id, new Promise((resolve) => (open = resolve)));
    const back = new Target('j1', 2);
    const resuming = dispatcher.resume(
      back,
      [resumed, waiting].map(({ id }) => ({
        ref: { submissionId: id, generation: 1 },
        lastSeqSent: 1,
      })),
    );
    await flush();
    dispatcher.abort(resumed.id);
    back.isClosed = true;
    await dispatcher.judgeLost(back);
    open();
    await resuming;
    jest.advanceTimersByTime(TIMINGS.resumeGraceMs);
    await flush();
    expect(expired).toContainEqual({
      ref: { submissionId: resumed.id, generation: 1 },
      abortRequested: true,
    });
  });

  describe('abort marks', () => {
    /** The dispatcher's remembered api aborts of held runs (`id.generation`). */
    const marks = () =>
      (dispatcher as unknown as { abortsRequested: Set<string> })
        .abortsRequested;

    it('drops the mark when the aborted run is rejudged, and the new generation is not aborted', async () => {
      const judge = await online(new Target('j1', 3));
      const submission = entry();
      await queue(submission);
      dispatcher.abort(submission.id);
      await queue({ ...submission, priority: 2, generation: 1 });
      expect(marks().size).toBe(0);
      await dispatcher.judgeLost(judge);
      expect(dispatcher.heldIds()).toEqual([submission.id]);
      expect(expired).toEqual([]);
      jest.advanceTimersByTime(60_000);
      await flush();
      expect(expired).toEqual([
        {
          ref: { submissionId: submission.id, generation: 2 },
          abortRequested: false,
        },
      ]);
    });

    it('reports an api abort of the held run until the run ends, and never for another generation', async () => {
      const judge = await online(new Target('j1'));
      const submission = entry();
      await queue(submission);
      const ref = { submissionId: submission.id, generation: 1 };
      expect(dispatcher.isAbortRequested(ref)).toBe(false);
      dispatcher.abort(submission.id);
      expect(dispatcher.isAbortRequested(ref)).toBe(true);
      expect(dispatcher.isAbortRequested({ ...ref, generation: 2 })).toBe(
        false,
      );
      await dispatcher.runEnded(judge, ref, { retried: false });
      expect(dispatcher.isAbortRequested(ref)).toBe(false);
      expect(dispatcher.queuedIds()).toEqual([]);
    });

    it('keeps the mark of a run another live session holds, so its holder still honours the abort', async () => {
      const dead = await online(new Target('j1'));
      const submission = entry();
      await queue(submission);
      dispatcher.abort(submission.id);
      const holder = new Target('j2');
      holder.inFlight.set(submission.id, 1);
      await online(holder);
      await dispatcher.judgeLost(dead);
      jest.advanceTimersByTime(60_000);
      await flush();
      expect(expired).toEqual([]);
      expect([...marks()]).toEqual([`${submission.id}.1`]);
      await dispatcher.runEnded(
        holder,
        { submissionId: submission.id, generation: 1 },
        { retried: false },
      );
      expect(marks().size).toBe(0);
    });
  });

  it('moves the runs of a replaced session to the new one', async () => {
    const first = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    stored.set(`${submission.id}.1`, 2);
    const second = new Target('j1');
    const plan = await dispatcher.resume(second, [
      { ref: { submissionId: submission.id, generation: 1 }, lastSeqSent: 2 },
    ]);
    expect(first.wasReplaced).toBe(true);
    expect(plan.resume[0]).toMatchObject({
      action: Resume_Action.ACTION_CONTINUE,
      fromSeq: 3,
    });
    await dispatcher.register(second);
    await dispatcher.judgeLost(first);
    expect(dispatcher.connectedNames()).toEqual(['j1']);
    expect(second.inFlight.get(submission.id)).toBe(1);
  });

  it('counts runs resumed by a session still in its handshake as held, and routes aborts for them through its Welcome or to the judge', async () => {
    const judge = await online(new Target('j1', 3));
    const [waiting, resumed, late] = [entry(), entry(), entry()];
    await queue(waiting, resumed, late);
    await dispatcher.judgeLost(judge);
    for (const { id } of [waiting, resumed, late]) stored.set(`${id}.1`, 1);
    let open: () => void = () => undefined;
    resumeGates.set(waiting.id, new Promise((resolve) => (open = resolve)));
    const back = new Target('j1', 3);
    const resuming = dispatcher.resume(
      back,
      [resumed, waiting, late].map(({ id }) => ({
        ref: { submissionId: id, generation: 1 },
        lastSeqSent: 1,
      })),
    );
    await flush();
    // `resumed` is resumed already, `waiting` is still read in grace
    dispatcher.abort(resumed.id);
    dispatcher.abort(waiting.id);
    open();
    const plan = await resuming;
    expect(plan.abort.map((ref) => ref.submissionId).sort()).toEqual(
      [resumed.id, waiting.id].sort(),
    );
    expect(dispatcher.heldIds().sort()).toEqual(
      [waiting.id, resumed.id, late.id].sort(),
    );
    dispatcher.abort(late.id);
    expect(back.aborted).toEqual([{ submissionId: late.id, generation: 1 }]);
    await dispatcher.register(back);
    expect(dispatcher.connectedNames()).toEqual(['j1']);
  });

  it('lets the newer of two overlapping handshakes of a judge win, and resumes the runs there', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(judge);
    stored.set(`${submission.id}.1`, 1);
    const listed = [
      { ref: { submissionId: submission.id, generation: 1 }, lastSeqSent: 1 },
    ];
    let open: () => void = () => undefined;
    resumeGates.set(submission.id, new Promise((resolve) => (open = resolve)));
    const older = new Target('j1');
    const olderResume = dispatcher.resume(older, listed);
    await flush();
    resumeGates.clear();
    const newer = new Target('j1');
    expect((await dispatcher.resume(newer, listed)).resume).toEqual([
      expect.objectContaining({ action: Resume_Action.ACTION_CONTINUE }),
    ]);
    expect(older.wasReplaced).toBe(true);
    open();
    await olderResume;
    await dispatcher.register(older);
    await dispatcher.register(newer);
    expect(newer.wasReplaced).toBe(false);
    expect(dispatcher.sessionOf('j1')).toBe(newer);
    expect(older.inFlight.size).toBe(0);
    expect(newer.inFlight.get(submission.id)).toBe(1);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(expired).toEqual([]);
  });

  it('lets only the newer handshake expire grace entries, so a run it is reading stays in grace', async () => {
    const judge = await online(new Target('j1', 2));
    const [olderRun, newerRun] = [entry(), entry()];
    await queue(olderRun, newerRun);
    await dispatcher.judgeLost(judge);
    for (const { id } of [olderRun, newerRun]) stored.set(`${id}.1`, 1);
    const listing = (id: string) => [
      { ref: { submissionId: id, generation: 1 }, lastSeqSent: 1 },
    ];
    let openOlder: () => void = () => undefined;
    let openNewer: () => void = () => undefined;
    resumeGates.set(
      olderRun.id,
      new Promise((resolve) => (openOlder = resolve)),
    );
    resumeGates.set(
      newerRun.id,
      new Promise((resolve) => (openNewer = resolve)),
    );
    const older = dispatcher.resume(new Target('j1', 2), listing(olderRun.id));
    await flush();
    const newer = new Target('j1', 2);
    const newerResume = dispatcher.resume(newer, listing(newerRun.id));
    await flush();
    openOlder();
    await older;
    await flush();
    expect(expired).toEqual([]);
    openNewer();
    expect((await newerResume).resume).toEqual([
      expect.objectContaining({ action: Resume_Action.ACTION_CONTINUE }),
    ]);
    await flush();
    expect(expired.map(({ ref }) => ref.submissionId)).toEqual([olderRun.id]);
  });

  it('leaves a run in grace, with its abort, when reading it for a resume fails', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(judge);
    dispatcher.abort(submission.id);
    resumeGates.set(submission.id, Promise.reject(new Error('Mongo down')));
    await expect(
      dispatcher.resume(new Target('j1'), [
        { ref: { submissionId: submission.id, generation: 1 }, lastSeqSent: 1 },
      ]),
    ).rejects.toThrow('Mongo down');
    resumeGates.clear();
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(expired).toEqual([
      {
        ref: { submissionId: submission.id, generation: 1 },
        abortRequested: true,
      },
    ]);
  });

  it('keeps a RETRY ban when a resync queued the row first', async () => {
    const judge = await online(new Target('j1'));
    await dispatcher.setDisabled('j1', true);
    const submission = entry({ generation: 1 });
    await queue(submission);
    await dispatcher.enqueue([{ ...submission, retryBannedJudges: ['j1'] }]);
    await dispatcher.setDisabled('j1', false);
    expect(judge.assigned).toEqual([]);
    expect(dispatcher.queuedIds()).toEqual([submission.id]);
  });

  it('gives a queued entry the features its problem needs now, keeping its pin and bans', async () => {
    // j2 comes first: it would take the entry if the refresh dropped the pin.
    const free = await online(new Target('j2'));
    const judge = await online(new Target('j1', 2));
    const pinned = entry({
      judgeName: 'j1',
      bannedJudges: ['j9'],
      requiredFeatures: ['interactive.checker'],
    });
    await queue(pinned);
    expect(judge.assigned).toEqual([]);
    // The problem was re-imported without the feature; the resync reads the row again.
    await dispatcher.refreshRequiredFeatures([
      { ...pinned, judgeName: null, bannedJudges: [], requiredFeatures: [] },
    ]);
    expect(judge.assigned.map(({ ref }) => ref.submissionId)).toEqual([
      pinned.id,
    ]);
    expect(free.assigned).toEqual([]);

    await dispatcher.setDisabled('j2', true);
    const other = entry();
    await dispatcher.setDisabled('j1', true);
    await queue(other);
    await dispatcher.refreshRequiredFeatures([
      { ...other, requiredFeatures: ['interactive.checker'] },
    ]);
    await dispatcher.setDisabled('j1', false);
    expect(dispatcher.queuedIds()).toEqual([other.id]);
  });

  it('releases an unaccepted Assign alone and hands it to a free slot', async () => {
    const judge = await online(new Target('j1', 2));
    const [slow, fine] = [entry(), entry()];
    await queue(slow, fine);
    await dispatcher.acceptTimedOut(judge, {
      submissionId: slow.id,
      generation: 1,
    });
    expect(judge.aborted).toEqual([{ submissionId: slow.id, generation: 1 }]);
    // the row is QU again: the UI hears `queued`, not a stale `processing`
    expect(published).toEqual([slow.id]);
    // judge-v2 frees the slot only when the aborted run's process returns: no Assign until its Final{ABORTED}
    expect(judge.assigned).toHaveLength(2);
    expect(dispatcher.queuedIds()).toEqual([slow.id]);
    await dispatcher.windingEnded(judge, {
      submissionId: slow.id,
      generation: 1,
    });
    expect(judge.assigned.map((request) => request.ref)).toEqual([
      { submissionId: slow.id, generation: 1 },
      { submissionId: fine.id, generation: 1 },
      { submissionId: slow.id, generation: 2 },
    ]);
    await dispatcher.acceptTimedOut(judge, {
      submissionId: slow.id,
      generation: 1,
    });
    expect(judge.aborted).toHaveLength(1);
  });

  it('sends a run refused with SLOTS_FULL back to the queue unspent, away from that judge until the next resync tick', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    const ref = { submissionId: submission.id, generation: 1 };
    await dispatcher.slotsRefused(judge, ref);
    expect(judge.aborted).toEqual([]);
    expect(judge.inFlight.size).toBe(0);
    expect(published).toEqual([submission.id]);
    expect(judge.assigned).toHaveLength(1);
    expect(dispatcher.queuedIds()).toEqual([submission.id]);
    await dispatcher.slotsRefused(judge, ref);
    await dispatcher.clearRetryBans();
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
  });

  it('ends a run refused with SLOTS_FULL as AB when the user aborted it meanwhile', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    dispatcher.abort(submission.id);
    const ref = { submissionId: submission.id, generation: 1 };
    await dispatcher.slotsRefused(judge, ref);
    expect(expired).toEqual([{ ref, abortRequested: true }]);
    expect(published).toEqual([]);
    expect(dispatcher.queuedIds()).toEqual([]);
  });

  it('keeps a RETRY away from the judge that answered it until the next resync tick', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    await dispatcher.runEnded(
      judge,
      { submissionId: submission.id, generation: 1 },
      { retried: true },
    );
    expect(judge.assigned).toHaveLength(1);
    expect(dispatcher.queuedIds()).toEqual([submission.id]);
    await dispatcher.clearRetryBans();
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
  });

  it('frees the slot of a run whose Final was not stored and requeues it unspent; if that fails too, nothing holds it, so the resync requeues it', async () => {
    const judge = await online(new Target('j1', 1));
    const submission = entry();
    await queue(submission);
    await dispatcher.finalNotStored(judge, {
      submissionId: submission.id,
      generation: 1,
    });
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
    requeueFails = true;
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await dispatcher.finalNotStored(judge, {
        submissionId: submission.id,
        generation: 2,
      });
    } finally {
      errors.mockRestore();
    }
    expect(judge.inFlight.size).toBe(0);
    expect(judge.winding.size).toBe(0);
    expect(dispatcher.heldIds()).toEqual([]);
    expect(judge.assigned).toHaveLength(2);
  });

  it('keeps a run whose Final is being stored when a resync reads the row its RETRY just requeued: no Abort, no winding slot', async () => {
    const judge = await online(new Target('j1', 1));
    const submission = entry();
    await queue(submission);
    const ref = { submissionId: submission.id, generation: 1 };
    judge.settling.add(`${submission.id}.1`);
    await dispatcher.enqueue([{ ...submission, generation: 1 }]);
    expect(judge.aborted).toEqual([]);
    expect(judge.winding.size).toBe(0);
    judge.settling.clear();
    await dispatcher.runEnded(judge, ref, { retried: true });
    await dispatcher.clearRetryBans();
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
  });
});
