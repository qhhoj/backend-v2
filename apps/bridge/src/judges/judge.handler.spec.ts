import { createServer, connect } from 'node:net';
import type { Server, Socket } from 'node:net';
import { waitUntil } from '../../test/fixtures';
import { encodePacket } from '../protocol/packet-codec';
import type { Packet } from '../protocol/packet-codec';
import { JudgeHandler } from './judge.handler';
import type { JudgeHandlerServices } from './judge.handler';

const TIMINGS = {
  handshakeMs: 2000,
  idleMs: 60_000,
  ackMs: 60_000,
  pingIntervalMs: 60_000,
  resyncMs: 60_000,
};
const outage = () => Promise.reject(new Error('mongo down'));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A handler on a real loopback socket, with stub services; `client` is the judge's end. */
function useHandler(build: () => Record<string, unknown>) {
  const state = {} as {
    server: Server;
    handler: JudgeHandler;
    client: Socket;
    unhandled: unknown[];
  };
  const record = (reason: unknown) => state.unhandled.push(reason);
  beforeEach(async () => {
    state.unhandled = [];
    process.on('unhandledRejection', record);
    const services = build() as unknown as JudgeHandlerServices;
    const connected = new Promise<void>((resolve) => {
      state.server = createServer((socket) => {
        state.handler = new JudgeHandler(socket, services);
        resolve();
      });
    });
    await new Promise<void>((resolve) =>
      state.server.listen(0, '127.0.0.1', resolve),
    );
    state.client = connect(
      (state.server.address() as { port: number }).port,
      '127.0.0.1',
    );
    state.client.on('error', () => undefined);
    await connected;
  });
  afterEach(async () => {
    process.off('unhandledRejection', record);
    state.client.destroy();
    await state.handler.finished;
    await new Promise((resolve) => state.server.close(resolve));
  });
  const send = (packet: Packet) => state.client.write(encodePacket(packet));
  const handshake = () =>
    send({
      name: 'handshake',
      id: 'judge-1',
      key: 'k',
      problems: [],
      executors: {},
    });
  return { state, send, handshake };
}

const judgesStub = (overrides: Record<string, unknown> = {}) => ({
  authenticate: () =>
    Promise.resolve({ isDisabled: false, authKeyHash: 'hash' }),
  markOnline: () => Promise.resolve(),
  markOffline: () => Promise.resolve(),
  updatePing: () => Promise.resolve(),
  updateProblems: () => Promise.resolve(),
  ...overrides,
});

describe('JudgeHandler when the stores fail', () => {
  const { state, send, handshake } = useHandler(() => ({
    judges: judgesStub(),
    dispatch: {
      register: () => Promise.resolve(),
      offerWork: outage,
      judgeFree: outage,
      judgeLost: () => Promise.resolve(),
      isStopped: () => false,
    },
    grading: {
      beginGrading: () => Promise.resolve(),
      gradingEnd: outage,
      internalError: outage,
    },
    timings: TIMINGS,
  }));
  const connectAs = async () => {
    handshake();
    await waitUntil(() => state.handler.name === 'judge-1');
  };

  it('keeps the connection and leaks no rejection when offering work fails', async () => {
    await connectAs();
    send({ name: 'supported-problems', problems: [] });
    await pause(200);
    expect(state.handler.isClosed).toBe(false);
    expect(state.unhandled).toEqual([]);
  });

  it('leaks no rejection when freeing the judge and writing the verdict both fail', async () => {
    await connectAs();
    state.handler.workingOn = 'sub-1';
    send({ name: 'grading-begin', 'submission-id': 'sub-1', pretested: false });
    send({ name: 'grading-end', 'submission-id': 'sub-1' });
    await pause(200);
    expect(state.handler.isClosed).toBe(false);
    expect(state.unhandled).toEqual([]);
  });

  it('still closes on an acknowledgement of another submission when failing its own submission fails', async () => {
    await connectAs();
    state.handler.workingOn = 'sub-1';
    send({ name: 'submission-acknowledged', 'submission-id': 'other' });
    await state.handler.finished;
    expect(state.handler.isClosed).toBe(true);
    expect(state.handler.workingOn).toBe('sub-1');
    expect(state.unhandled).toEqual([]);
  });
});

describe('JudgeHandler when marking the judge online fails', () => {
  const register = jest.fn(() => Promise.resolve());
  const { state, handshake } = useHandler(() => ({
    judges: judgesStub({ markOnline: outage }),
    dispatch: {
      register,
      judgeLost: () => Promise.resolve(),
      isStopped: () => false,
    },
    grading: {},
    timings: TIMINGS,
  }));

  it('closes the connection and never registers the judge', async () => {
    handshake();
    await state.handler.finished;
    expect(state.handler.isClosed).toBe(true);
    expect(register).not.toHaveBeenCalled();
    expect(state.unhandled).toEqual([]);
  });
});

describe('JudgeHandler liveness while a packet is being handled', () => {
  const IDLE_MS = 300;
  const HANDLING_MS = 700;
  const judgeLost = jest.fn(() => Promise.resolve());
  const { state, send, handshake } = useHandler(() => ({
    judges: judgesStub(),
    dispatch: {
      register: () => Promise.resolve(),
      judgeLost,
      isStopped: () => false,
    },
    grading: { compileMessage: () => pause(HANDLING_MS) },
    timings: { ...TIMINGS, idleMs: IDLE_MS, pingIntervalMs: 100 },
  }));

  it('does not count the handling time as silence, and spends no requeue', async () => {
    handshake();
    await waitUntil(() => state.handler.name === 'judge-1');
    state.handler.workingOn = 'sub-1';
    send({ name: 'compile-message', 'submission-id': 'sub-1', log: 'x' });
    await pause(HANDLING_MS + IDLE_MS / 2);
    expect(state.handler.isClosed).toBe(false);
    expect(judgeLost).not.toHaveBeenCalled();
  });
});

describe('JudgeHandler on test-case packets', () => {
  const addCases = jest.fn<
    Promise<string>,
    [string, string, { batch: number | null }[]]
  >(() => Promise.resolve('appended'));
  const markBatched = jest.fn(() => Promise.resolve());
  const { state, send, handshake } = useHandler(() => ({
    judges: judgesStub(),
    dispatch: {
      register: () => Promise.resolve(),
      offerWork: () => Promise.resolve(),
      judgeFree: () => Promise.resolve(),
      judgeLost: () => Promise.resolve(),
      isStopped: () => false,
    },
    grading: {
      beginGrading: () => Promise.resolve(),
      markBatched,
      addCases,
    },
    timings: TIMINGS,
  }));
  const caseOf = (position: number) => ({
    position,
    status: 0,
    time: 0.01,
    memory: 1024,
    points: 1,
    'total-points': 1,
    feedback: '',
    'extended-feedback': '',
    output: '',
  });
  const beginGradingOf = async (submissionId: string) => {
    handshake();
    await waitUntil(() => state.handler.name === 'judge-1');
    state.handler.workingOn = submissionId;
    send({
      name: 'grading-begin',
      'submission-id': submissionId,
      pretested: false,
    });
  };

  beforeEach(() => {
    addCases.mockClear();
    markBatched.mockClear();
  });

  it('closes the connection when a judge sends more cases than a submission may have', async () => {
    await beginGradingOf('sub-1');
    addCases.mockResolvedValueOnce('full');
    send({
      name: 'test-case-status',
      'submission-id': 'sub-1',
      cases: [caseOf(1)],
    });
    await state.handler.finished;
    expect(state.handler.isClosed).toBe(true);
  });

  it('keeps the connection and stores cases appended within the limit', async () => {
    await beginGradingOf('sub-1');
    send({
      name: 'test-case-status',
      'submission-id': 'sub-1',
      cases: [caseOf(1)],
    });
    await waitUntil(() => addCases.mock.calls.length === 1);
    expect(state.handler.isClosed).toBe(false);
  });

  it('marks the submission batched once, and numbers each batch its cases arrive in', async () => {
    await beginGradingOf('sub-1');
    send({ name: 'batch-begin', 'submission-id': 'sub-1' });
    send({
      name: 'test-case-status',
      'submission-id': 'sub-1',
      cases: [caseOf(1)],
    });
    send({ name: 'batch-end', 'submission-id': 'sub-1' });
    send({ name: 'batch-begin', 'submission-id': 'sub-1' });
    send({
      name: 'test-case-status',
      'submission-id': 'sub-1',
      cases: [caseOf(2)],
    });
    await waitUntil(() => addCases.mock.calls.length === 2);
    expect(markBatched).toHaveBeenCalledTimes(1);
    const batchesOf = addCases.mock.calls.map(([, , cases]) => cases[0].batch);
    expect(batchesOf).toEqual([1, 2]);
  });
});
