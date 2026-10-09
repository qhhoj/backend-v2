import { newId } from '@libs/database';
import { Resume_Action } from '@libs/judge-proto';
import type { AssignmentRef } from '@libs/judge-proto';
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
  disconnect(): void {
    this.isClosed = true;
  }
  /** A replaced `JudgeSession` ends its stream at once. */
  replaced(): void {
    this.wasReplaced = true;
    this.isClosed = true;
  }
}

const TIMINGS = { resumeGraceMs: 30_000 } as BridgeTimings;
const entry = (fields: Partial<QueuedSubmission> = {}): QueuedSubmission => ({
  id: newId(),
  problemCode: 'sum',
  languageKey: 'CPP17',
  priority: 1,
  generation: 0,
  judgeName: null,
  bannedJudges: [],
  retryBannedJudges: [],
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
    dispatcher = new DispatcherService(submissions, runs, TIMINGS);
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

  it('gives a draining judge nothing new', async () => {
    const judge = await online(new Target('j1', 4));
    judge.isDraining = true;
    await queue(entry());
    expect(judge.assigned).toEqual([]);
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

  it('assigns a rejudge to the spare slot of a two-slot judge at once, beside its winding run (conformance 21)', async () => {
    const judge = await online(new Target('j1', 2));
    const submission = entry();
    await queue(submission);
    await queue({ ...submission, priority: 2, generation: 1 });
    expect(judge.aborted).toEqual([
      { submissionId: submission.id, generation: 1 },
    ]);
    expect(judge.assigned.map((request) => request.ref.generation)).toEqual([
      1, 2,
    ]);
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

  it('keeps a run claimed after the row was read (a resync racing a dispatch)', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    await dispatcher.enqueue([{ ...submission, generation: 0 }]);
    expect(judge.aborted).toEqual([]);
    expect(judge.inFlight.get(submission.id)).toBe(1);
    expect(dispatcher.queuedIds()).toEqual([]);
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

  it('expires an aborted run in grace as an abort', async () => {
    const judge = await online(new Target('j1'));
    const submission = entry();
    await queue(submission);
    await dispatcher.judgeLost(judge);
    dispatcher.abort(submission.id);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(expired).toEqual([
      {
        ref: { submissionId: submission.id, generation: 1 },
        abortRequested: true,
      },
    ]);
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

  it('leaves the rows of judges lost while stopping alone, and fires no grace after stop', async () => {
    const judge = await online(new Target('j1'));
    await queue(entry());
    dispatcher.stop();
    await dispatcher.judgeLost(judge);
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(expired).toEqual([]);
    expect(dispatcher.heldIds()).toHaveLength(1);
  });
});
