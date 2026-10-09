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
    windDown: record('windDown'),
    windingEnded: record('windingEnded'),
    acceptTimedOut: record('acceptTimedOut'),
    judgeLost: record('judgeLost'),
    isStopped: () => false,
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
    // the judge speaks minor 3, above the bridge's: the bridge's own minor wins
    expect(welcome.protocolMinor).toBe(PROTOCOL_MINOR);
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

  it('refuses a second Hello', async () => {
    await online();
    await receive(HELLO);
    expect(call.statuses).toEqual([
      expect.objectContaining({ code: status.INVALID_ARGUMENT }),
    ]);
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

  it('releases an Assign not accepted in time', async () => {
    const ref = run(newId());
    await holding(ref);
    jest.advanceTimersByTime(TIMINGS.acceptMs);
    await settle();
    expect(calls.acceptTimedOut).toEqual([[session, ref]]);
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

  it('records the round trip of a pong to its own ping only', async () => {
    await online();
    const [ping] = call.bodies('ping');
    const nonce = ping.$case === 'ping' ? ping.ping.nonce : 0;
    await receive(
      JudgeMessage.fromPartial({
        body: { $case: 'pong', pong: { nonce, busy: 9, load: 0.5 } },
      }),
    );
    const [[name, , recorded]] = calls.recordPong as [
      [string, Date, { ping: number }],
    ];
    expect(name).toBe('j1');
    expect(recorded).toMatchObject({ load: 0.5, busy: 2 });
    expect(recorded.ping).toBeGreaterThanOrEqual(0);
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

  it('logs the connect with the address, build and resume counts, and the disconnect with its reason', async () => {
    dispatch.resume = record('resume', {
      resume: [
        { ref: run(newId()), action: Resume_Action.ACTION_CONTINUE },
        { ref: run(newId()), action: Resume_Action.ACTION_DROP },
      ],
      abort: [],
    });
    const lines: string[] = [];
    const logs = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message) => void lines.push(String(message)));
    try {
      await online();
      call.emit('end');
      await session.finished;
    } finally {
      logs.mockRestore();
      dispatch.resume = record('resume', { resume: [], abort: [] });
    }
    expect(lines).toEqual([
      `Judge j1 connected from 10.0.0.5: build qhhoj-judge 0.1.0, protocol 1.${PROTOCOL_MINOR}, 2 slots, 1 runtimes, resumed 1, dropped 1`,
      'Judge j1 disconnected: the judge ended its stream; 0 runs held',
    ]);
  });

  it('logs a lost connection, and a session that never said Hello', async () => {
    const lines: string[] = [];
    const logs = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message) => void lines.push(String(message)));
    try {
      jest.advanceTimersByTime(TIMINGS.handshakeMs);
      await session.finished;
    } finally {
      logs.mockRestore();
    }
    expect(lines).toEqual([
      'Judge j1 disconnected before Hello: no Hello in time; 0 runs held',
    ]);
  });
});
