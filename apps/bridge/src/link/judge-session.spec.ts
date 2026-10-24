import { status } from '@grpc/grpc-js';
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { newId } from '@libs/database';
import {
  BridgeMessage,
  ErrorCode,
  JudgeMessage,
  Outcome,
  PROTOCOL_MINOR,
  Resume_Action,
  Status,
} from '@libs/judge-proto';
import type { AssignmentRef } from '@libs/judge-proto';
import { DEFAULT_BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import type { DispatcherService } from '../dispatch/dispatcher.service';
import type { JudgesRepository } from '../judges/judges.repository';
import type { AssignRequest } from '../submissions/assign-request';
import type { RunsService } from '../submissions/runs.service';
import type { WriteOutcome } from '../submissions/write-outcome';
import { JudgeSession } from './judge-session';
import type { SessionCall } from './judge-session';

/** The server side of one Session stream, recorded. */
class FakeCall extends EventEmitter {
  readonly written: BridgeMessage[] = [];
  readonly statuses: Array<{ code: status; details: string }> = [];
  ended = false;
  paused = false;
  write(message: BridgeMessage): boolean {
    this.written.push(message);
    return true;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  end(): void {
    this.ended = true;
    setImmediate(() => this.emit('close'));
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'error') {
      this.statuses.push(args[0] as { code: status; details: string });
      setImmediate(() => super.emit('close'));
    }
    return super.emit(event, ...args);
  }
  errorCodes(): ErrorCode[] {
    return this.written.flatMap((message) =>
      message.body?.$case === 'error' ? [message.body.error.code] : [],
    );
  }
  bodies(kind: string) {
    return this.written.flatMap((message) =>
      message.body?.$case === kind ? [message.body] : [],
    );
  }
}

/** The production timings; the tests advance fake timers by them. */
const TIMINGS: BridgeTimings = DEFAULT_BRIDGE_TIMINGS;
const settle = async () => {
  for (let round = 0; round < 5; round += 1)
    await new Promise((resolve) => setImmediate(resolve));
};
const assignment = (ref: AssignmentRef): AssignRequest => ({
  ref,
  problemCode: 'sum',
  dataVersion: 1,
  languageKey: 'CPP17',
  source: 'int main() {}',
  fileOnly: false,
  sourceSize: 13,
  timeLimit: 1,
  memoryLimit: 65536,
  shortCircuit: true,
  pretestsOnly: false,
  inContest: null,
  attemptNo: 1,
  userId: newId(),
});
const HELLO = JudgeMessage.fromPartial({
  body: {
    $case: 'hello',
    hello: {
      protocolMinor: 3,
      build: 'qhhoj-judge 0.1.0',
      slots: 2,
      runtimes: [{ languageKey: 'CPP17', name: 'g++', version: '13.2' }],
    },
  },
});

describe('JudgeSession', () => {
  let call: FakeCall;
  let session: JudgeSession;
  let outcome: WriteOutcome;
  /** Submissions whose run the dispatcher holds an api abort for. */
  let abortsRequested: Set<string>;
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, result: unknown = undefined) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return Promise.resolve(
        typeof result === 'function' ? (result as () => unknown)() : result,
      );
    };
  const dispatch = {
    resume: record('resume', { resume: [], abort: [] }),
    register: record('register'),
    runEnded: record('runEnded'),
    runStarted: record('runStarted'),
    windDown: record('windDown'),
    windingEnded: record('windingEnded'),
    acceptTimedOut: record('acceptTimedOut'),
    slotsRefused: record('slotsRefused'),
    judgeLost: record('judgeLost'),
    finalNotStored: record('finalNotStored'),
    isStopped: () => false,
    isAbortRequested: (ref: AssignmentRef) =>
      abortsRequested.has(ref.submissionId),
  };
  const runs = {
    accepted: record('accepted', () => outcome),
    compiled: record('compiled', () => outcome),
    started: record('started', () => outcome),
    cases: record('cases', () => outcome),
    final: record('final', () => outcome),
  };
  const judges = {
    markSessionOnline: record('markSessionOnline'),
    recordPong: record('recordPong'),
    markOffline: record('markOffline'),
  };
  const receive = async (message: JudgeMessage, bytes = 64) => {
    call.emit('data', { message, bytes });
    await settle();
  };
  const run = (submissionId: string, generation = 1): AssignmentRef => ({
    submissionId,
    generation,
  });
  const online = async () => {
    await receive(HELLO);
    return session;
  };
  const holding = async (ref: AssignmentRef) => {
    await online();
    session.inFlight.set(ref.submissionId, ref.generation);
    session.assign(assignment(ref));
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    for (const key of Object.keys(calls)) delete calls[key];
    outcome = 'applied';
    abortsRequested = new Set();
    call = new FakeCall();
    session = new JudgeSession(
      call as unknown as SessionCall,
      { name: 'j1', isDisabled: false, authKeyHash: 'h', address: '10.0.0.5' },
      {
        dispatch: dispatch as unknown as DispatcherService,
        runs: runs as unknown as RunsService,
        judges: judges as unknown as JudgesRepository,
        timings: TIMINGS,
      },
    );
  });
  afterEach(() => jest.useRealTimers());

  it('closes a session whose first message is not Hello, with a BridgeError, and registers nothing', async () => {
    await receive(
      JudgeMessage.fromPartial({ body: { $case: 'pong', pong: { nonce: 1 } } }),
    );
    expect(call.errorCodes()).toEqual([ErrorCode.ERROR_CODE_PROTOCOL]);
    expect(call.statuses).toEqual([
      expect.objectContaining({ code: status.INVALID_ARGUMENT }),
    ]);
    expect(calls.register).toBeUndefined();
  });

  it('answers Hello with Welcome (lower minor, limits, resume plan), marks the judge online, pings and registers it', async () => {
    dispatch.resume = record('resume', {
      resume: [
        { ref: run(newId()), action: Resume_Action.ACTION_DROP, fromSeq: 0 },
      ],
      abort: [],
    });
    await online();
    const [body] = call.bodies('welcome');
    if (body?.$case !== 'welcome') throw new Error('no Welcome');
    const { welcome } = body;
    expect(welcome.sessionId).toBe(session.id);
    // a minor-3 judge, below the bridge's: the lower minor wins
    expect(PROTOCOL_MINOR).toBeGreaterThan(3);
    expect(welcome.protocolMinor).toBe(3);
    expect(welcome.limits).toMatchObject({
      maxCasesPerMessage: 256,
      acceptTimeoutMs: 20_000,
      resumeGraceMs: 30_000,
    });
    expect(welcome.resume.map((entry) => entry.action)).toEqual([
      Resume_Action.ACTION_DROP,
    ]);
    expect(calls.markSessionOnline[0][2]).toMatchObject({
      slots: 2,
      build: 'qhhoj-judge 0.1.0',
      lastIp: '10.0.0.5',
    });
    expect(call.bodies('ping')).toHaveLength(1);
    expect(calls.register).toEqual([[session]]);
    expect(session.slots).toBe(2);
    expect([...session.executors]).toEqual(['CPP17']);
  });

  it('leaves the admin row to the newer session when it is replaced during its resume', async () => {
    dispatch.resume = record('resume', () => {
      session.replaced();
      return { resume: [], abort: [] };
    });
    try {
      await online();
      expect(calls.markSessionOnline).toBeUndefined();
      expect(calls.register).toBeUndefined();
    } finally {
      dispatch.resume = record('resume', { resume: [], abort: [] });
    }
  });

  it('stores a held run message, acks its seq, and stops the accept clock at seq 1', async () => {
    const ref = run(newId());
    await holding(ref);
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'accepted', accepted: { ref, seq: 1 } },
      }),
    );
    expect(calls.accepted).toEqual([[{ ref, judgeName: 'j1', seq: 1 }]]);
    expect(call.bodies('ack')).toEqual([
      { $case: 'ack', ack: { ref, seq: 1 } },
    ]);
    jest.advanceTimersByTime(TIMINGS.acceptMs);
    expect(calls.acceptTimedOut).toBeUndefined();
  });

  it('hands a run the judge refused with SLOTS_FULL back to the dispatcher and keeps the session', async () => {
    const ref = run(newId());
    await holding(ref);
    await receive(
      JudgeMessage.fromPartial({
        body: {
          $case: 'error',
          error: {
            code: ErrorCode.ERROR_CODE_SLOTS_FULL,
            message: 'full',
            ref,
          },
        },
      }),
    );
    expect(calls.slotsRefused).toEqual([[session, ref]]);
    expect(session.isClosed).toBe(false);
    jest.advanceTimersByTime(TIMINGS.acceptMs);
    await settle();
    expect(calls.acceptTimedOut).toBeUndefined();
  });

  it('frees the slot of a winding run the judge refused with SLOTS_FULL, and ignores one it never had', async () => {
    await online();
    const released = run(newId());
    session.winding.add(`${released.submissionId}.1`);
    const slotsFull = (ref: AssignmentRef) =>
      JudgeMessage.fromPartial({
        body: {
          $case: 'error',
          error: {
            code: ErrorCode.ERROR_CODE_SLOTS_FULL,
            message: 'full',
            ref,
          },
        },
      });
    await receive(slotsFull(released));
    expect(calls.windingEnded).toEqual([[session, released]]);
    await receive(slotsFull(run(newId())));
    expect(calls.slotsRefused).toBeUndefined();
    expect(session.isClosed).toBe(false);
  });

  it('keeps the accept clock of a run when an older generation of its submission is aborted', async () => {
    const id = newId();
    const current = run(id, 2);
    await holding(current);
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'started', started: { ref: run(id, 1), seq: 2 } },
      }),
    );
    expect(call.bodies('abort')).toEqual([
      { $case: 'abort', abort: { ref: run(id, 1) } },
    ]);
    jest.advanceTimersByTime(TIMINGS.acceptMs);
    await settle();
    expect(calls.acceptTimedOut).toEqual([[session, current]]);
  });

  it('answers messages of a run it does not hold with one Abort, and closes on Accepted for one', async () => {
    await online();
    const stale = run(newId(), 7);
    for (const seq of [2, 3])
      await receive(
        JudgeMessage.fromPartial({
          body: { $case: 'started', started: { ref: stale, seq } },
        }),
      );
    expect(call.bodies('abort')).toEqual([
      { $case: 'abort', abort: { ref: stale } },
    ]);
    expect(calls.started).toBeUndefined();
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'accepted', accepted: { ref: run(newId()), seq: 1 } },
      }),
    );
    expect(call.statuses).toEqual([
      expect.objectContaining({ code: status.INVALID_ARGUMENT }),
    ]);
  });

  it.each([
    ['applied', true],
    ['duplicate', false],
  ] as const)(
    'passes the case count of a %s Started to the dispatcher only when stored',
    async (result, isPassed) => {
      const ref = run(newId());
      await holding(ref);
      outcome = result;
      await receive(
        JudgeMessage.fromPartial({
          body: { $case: 'started', started: { ref, seq: 2, caseCount: 400 } },
        }),
      );
      expect(calls.runStarted).toEqual(
        isPassed ? [[session, ref, 400]] : undefined,
      );
    },
  );

  it.each([
    ['duplicate', 'ack', undefined],
    ['gap', 'error', status.INVALID_ARGUMENT],
    ['order', 'error', status.INVALID_ARGUMENT],
    ['full', 'error', status.INVALID_ARGUMENT],
  ] as const)('answers a %s write with %s', async (result, kind, code) => {
    const ref = run(newId());
    await holding(ref);
    outcome = result;
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'started', started: { ref, seq: 2 } },
      }),
    );
    expect(call.bodies(kind)).toHaveLength(1);
    expect(call.statuses.map((sent) => sent.code)).toEqual(
      code === undefined ? [] : [code],
    );
  });

  it('aborts a run whose row moved on and keeps its slot until the judge ends it', async () => {
    const ref = run(newId());
    await holding(ref);
    outcome = 'stale';
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'started', started: { ref, seq: 2 } },
      }),
    );
    expect(call.bodies('abort')).toHaveLength(1);
    expect(calls.windDown).toEqual([[session, ref]]);
    expect(calls.runEnded).toBeUndefined();
    expect(calls.windingEnded).toBeUndefined();
  });

  it('frees the slot at once when the Final itself finds the row moved on', async () => {
    const ref = run(newId());
    await holding(ref);
    outcome = 'stale';
    await receive(
      JudgeMessage.fromPartial({
        body: {
          $case: 'final',
          final: { ref, seq: 5, outcome: Outcome.OUTCOME_GRADED },
        },
      }),
    );
    expect(calls.windDown).toEqual([[session, ref]]);
    expect(calls.windingEnded).toEqual([[session, ref]]);
    expect(calls.runEnded).toBeUndefined();
  });

  it('frees the slot of a winding run on its Final: no write, no ack, no Abort echo', async () => {
    await online();
    const ref = run(newId(), 2);
    session.winding.add(`${ref.submissionId}.2`);
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'started', started: { ref, seq: 2 } },
      }),
    );
    await receive(
      JudgeMessage.fromPartial({
        body: {
          $case: 'final',
          final: { ref, seq: 3, outcome: Outcome.OUTCOME_ABORTED },
        },
      }),
    );
    expect(calls.started).toBeUndefined();
    expect(calls.final).toBeUndefined();
    expect(call.bodies('abort')).toEqual([]);
    expect(call.bodies('ack')).toEqual([]);
    expect(calls.windingEnded).toEqual([[session, ref]]);
    expect(call.statuses).toEqual([]);
  });

  it('ignores a late Accepted for a run it released or voided, and keeps the session', async () => {
    // released at the accept timeout: the dispatcher aborted it and freed the ref
    const released = run(newId());
    await holding(released);
    session.inFlight.delete(released.submissionId);
    session.abort(released);
    // voided by a rejudge: aborted and winding until its Final
    const voided = run(newId());
    session.inFlight.set(voided.submissionId, 1);
    session.assign(assignment(voided));
    session.inFlight.delete(voided.submissionId);
    session.winding.add(`${voided.submissionId}.1`);
    session.abort(voided);
    for (const ref of [released, voided])
      await receive(
        JudgeMessage.fromPartial({
          body: { $case: 'accepted', accepted: { ref, seq: 1 } },
        }),
      );
    expect(call.statuses).toEqual([]);
    expect(session.isClosed).toBe(false);
    expect(calls.accepted).toBeUndefined();
    expect(call.bodies('abort')).toHaveLength(2);
  });

  it('acks a Final and frees the slot, with a retry ban for RETRY', async () => {
    const [graded, retried] = [run(newId()), run(newId())];
    await holding(graded);
    session.inFlight.set(retried.submissionId, 1);
    await receive(
      JudgeMessage.fromPartial({
        body: {
          $case: 'final',
          final: { ref: graded, seq: 5, outcome: Outcome.OUTCOME_GRADED },
        },
      }),
    );
    await receive(
      JudgeMessage.fromPartial({
        body: {
          $case: 'final',
          final: { ref: retried, seq: 2, outcome: Outcome.OUTCOME_RETRY },
        },
      }),
    );
    expect(call.bodies('ack')).toHaveLength(2);
    expect(calls.runEnded).toEqual([
      [session, graded, { retried: false }],
      [session, retried, { retried: true }],
    ]);
  });

  it('ends a RETRY that crosses the user’s abort as AB: no requeue, no retry ban (an aborted run is never graded)', async () => {
    const ref = run(newId());
    await holding(ref);
    abortsRequested.add(ref.submissionId);
    await receive(
      JudgeMessage.fromPartial({
        body: {
          $case: 'final',
          final: {
            ref,
            seq: 3,
            outcome: Outcome.OUTCOME_RETRY,
            log: 'no data',
          },
        },
      }),
    );
    expect(calls.final).toEqual([
      [expect.anything(), expect.objectContaining({ kind: 'aborted' })],
    ]);
    expect(call.bodies('ack')).toEqual([
      { $case: 'ack', ack: { ref, seq: 3 } },
    ]);
    expect(calls.runEnded).toEqual([[session, ref, { retried: false }]]);
  });

  it('acks a Final resent after it was stored, without freeing the slot twice or aborting (conformance 37)', async () => {
    const ref = run(newId());
    await holding(ref);
    const resent = JudgeMessage.fromPartial({
      body: {
        $case: 'final',
        final: { ref, seq: 2, outcome: Outcome.OUTCOME_GRADED },
      },
    });
    await receive(resent);
    outcome = 'duplicate';
    await receive(resent);
    expect(call.bodies('ack')).toEqual([
      { $case: 'ack', ack: { ref, seq: 2 } },
      { $case: 'ack', ack: { ref, seq: 2 } },
    ]);
    expect(calls.final).toHaveLength(2);
    expect(call.bodies('abort')).toEqual([]);
    expect(calls.runEnded).toEqual([[session, ref, { retried: false }]]);
    outcome = 'stale';
    await receive(resent);
    expect(call.bodies('abort')).toEqual([{ $case: 'abort', abort: { ref } }]);
    expect(call.bodies('ack')).toHaveLength(2);
  });

  it('closes a session flooding more than 1000 messages in a second, even pongs that write nothing', async () => {
    await online();
    const pong = JudgeMessage.fromPartial({
      body: { $case: 'pong', pong: { nonce: 999 } },
    });
    for (let index = 0; index < 1001; index += 1)
      call.emit('data', { message: pong, bytes: 8 });
    await settle();
    expect(call.errorCodes()).toEqual([ErrorCode.ERROR_CODE_FLOOD]);
    expect(call.statuses).toEqual([
      expect.objectContaining({ code: status.RESOURCE_EXHAUSTED }),
    ]);
    expect(calls.recordPong).toBeUndefined();
  });

  it('closes a session that sends no Hello in time, or falls silent', async () => {
    jest.advanceTimersByTime(TIMINGS.handshakeMs);
    expect(call.statuses).toEqual([
      expect.objectContaining({ code: status.DEADLINE_EXCEEDED }),
    ]);
    call = new FakeCall();
    session = new JudgeSession(
      call as unknown as SessionCall,
      { name: 'j1', isDisabled: false, authKeyHash: 'h', address: null },
      {
        dispatch: dispatch as unknown as DispatcherService,
        runs: runs as unknown as RunsService,
        judges: judges as unknown as JudgesRepository,
        timings: TIMINGS,
      },
    );
    await online();
    jest.advanceTimersByTime(TIMINGS.idleMs + TIMINGS.pingIntervalMs);
    expect(call.statuses).toEqual([
      expect.objectContaining({
        code: status.DEADLINE_EXCEEDED,
        details: 'silent for too long',
      }),
    ]);
  });

  it('sends Disconnect before a forced close, and hands its runs to the dispatcher once closed', async () => {
    await online();
    session.disconnect({ isForced: true, reason: 'key rotated' });
    expect(call.bodies('disconnect')).toEqual([
      {
        $case: 'disconnect',
        disconnect: { forced: true, reason: 'key rotated' },
      },
    ]);
    expect(call.statuses).toEqual([
      { code: status.PERMISSION_DENIED, details: 'key rotated' },
    ]);
    await session.finished;
    expect(calls.judgeLost).toContainEqual([session]);
    expect(calls.markOffline).toContainEqual(['j1', expect.any(Date)]);
  });

  it('tells a replaced session why and ends it ABORTED; a graceful admin disconnect only asks', async () => {
    await online();
    session.disconnect({ isForced: false, reason: 'maintenance' });
    expect(call.statuses).toEqual([]);
    session.replaced();
    expect(
      call
        .bodies('disconnect')
        .map((body) => body.$case === 'disconnect' && body.disconnect.forced),
    ).toEqual([false, false]);
    expect(call.statuses).toEqual([
      expect.objectContaining({ code: status.ABORTED }),
    ]);
  });

  it('reads nothing more while a message is being stored (HTTP/2 flow control then holds the judge back)', async () => {
    const ref = run(newId());
    await holding(ref);
    let release: (value: WriteOutcome) => void = () => undefined;
    runs.compiled = () =>
      new Promise<WriteOutcome>((resolve) => (release = resolve));
    call.emit('data', {
      message: JudgeMessage.fromPartial({
        body: { $case: 'compiled', compiled: { ref, seq: 2 } },
      }),
      bytes: 32,
    });
    await settle();
    expect(call.paused).toBe(true);
    release('applied');
    await settle();
    expect(call.paused).toBe(false);
    expect(call.bodies('ack')).toHaveLength(1);
    runs.compiled = record('compiled', () => outcome);
  });

  it('retries a Final whose store fails; one never stored frees its slot through the dispatcher and keeps the session', async () => {
    const [flaky, lost] = [run(newId()), run(newId())];
    await holding(flaky);
    session.inFlight.set(lost.submissionId, 1);
    const finalOf = (ref: AssignmentRef) =>
      JudgeMessage.fromPartial({
        body: {
          $case: 'final',
          final: { ref, seq: 5, outcome: Outcome.OUTCOME_GRADED },
        },
      });
    /** Lets every wait of the store's retries pass. */
    const throughRetries = async () => {
      for (
        let wait = TIMINGS.finalWriteRetryMs;
        wait <= 8 * TIMINGS.finalWriteRetryMs;
        wait *= 2
      ) {
        await settle();
        await jest.advanceTimersByTimeAsync(wait);
      }
      await settle();
    };
    const stored = runs.final;
    let failures = 1;
    runs.final = (...args: unknown[]) =>
      failures-- > 0
        ? Promise.reject(new Error('Mongo down'))
        : stored(...args);
    const logs = [
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    ];
    try {
      call.emit('data', { message: finalOf(flaky), bytes: 32 });
      await throughRetries();
      expect(call.bodies('ack')).toEqual([
        { $case: 'ack', ack: { ref: flaky, seq: 5 } },
      ]);
      expect(calls.runEnded).toEqual([[session, flaky, { retried: false }]]);
      runs.final = () => Promise.reject(new Error('Mongo down'));
      call.emit('data', { message: finalOf(lost), bytes: 32 });
      await throughRetries();
    } finally {
      for (const log of logs) log.mockRestore();
      runs.final = stored;
    }
    expect(calls.finalNotStored).toEqual([[session, lost]]);
    expect(call.bodies('abort')).toEqual([
      { $case: 'abort', abort: { ref: lost } },
    ]);
    expect(call.bodies('ack')).toHaveLength(1);
    expect(session.isClosed).toBe(false);
    expect(call.statuses).toEqual([]);
    expect(call.paused).toBe(false);
  });

  it('logs a judge-reported error on one line, its text sanitized', async () => {
    await online();
    const warns = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await receive(
        JudgeMessage.fromPartial({
          body: {
            $case: 'error',
            error: {
              code: ErrorCode.ERROR_CODE_PROTOCOL,
              message: 'bad\nsecond line\u0007',
            },
          },
        }),
      );
      expect(warns.mock.calls).toEqual([
        [`j1 reports ${ErrorCode.ERROR_CODE_PROTOCOL}: bad second line`],
      ]);
    } finally {
      warns.mockRestore();
    }
  });

  it('logs a case reported with more points than its total, by run and position', async () => {
    const ref = run(newId());
    await holding(ref);
    const warns = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await receive(
        JudgeMessage.fromPartial({
          body: {
            $case: 'cases',
            cases: {
              ref,
              seq: 2,
              cases: [
                { position: 1, status: Status.STATUS_AC, points: 5, total: 1 },
                { position: 2, status: Status.STATUS_AC, points: 1, total: 1 },
              ],
            },
          },
        }),
      );
      expect(warns.mock.calls).toEqual([
        [
          `Judge j1 reported more points than the case total for submission ${ref.submissionId} gen 1, case 1; clamped to the total`,
        ],
      ]);
    } finally {
      warns.mockRestore();
    }
  });

  it('keeps the session when the store fails, and logs it with the run and seq', async () => {
    const ref = run(newId());
    await holding(ref);
    runs.compiled = () => Promise.reject(new Error('Mongo down'));
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await receive(
        JudgeMessage.fromPartial({
          body: { $case: 'compiled', compiled: { ref, seq: 2 } },
        }),
      );
      expect(errors.mock.calls).toEqual([
        [
          `Judge j1: handling compiled of submission ${ref.submissionId} gen 1 seq 2 failed: Mongo down`,
        ],
      ]);
    } finally {
      errors.mockRestore();
    }
    expect(call.statuses).toEqual([]);
    expect(session.isClosed).toBe(false);
    expect(call.paused).toBe(false);
    runs.compiled = record('compiled', () => outcome);
  });
});
