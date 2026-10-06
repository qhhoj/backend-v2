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
  authenticate: () => Promise.resolve({ isDisabled: false }),
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
    grading: { gradingEnd: outage, internalError: outage },
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
    send({ name: 'grading-end', 'submission-id': 'sub-1' });
    await pause(200);
    expect(state.handler.isClosed).toBe(false);
    expect(state.unhandled).toEqual([]);
  });

  it('still closes on a packet for another submission when failing its own submission fails', async () => {
    await connectAs();
    state.handler.workingOn = 'sub-1';
    send({ name: 'grading-end', 'submission-id': 'other' });
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
