import { createServer, connect } from 'node:net';
import type { Server, Socket } from 'node:net';
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

describe('JudgeHandler when the stores fail', () => {
  let server: Server;
  let handler: JudgeHandler;
  let client: Socket;
  let unhandled: unknown[];
  const record = (reason: unknown) => unhandled.push(reason);

  const services = {
    judges: {
      authenticate: () => Promise.resolve({ isDisabled: false }),
      markOnline: () => Promise.resolve(),
      markOffline: () => Promise.resolve(),
      updatePing: () => Promise.resolve(),
      updateProblems: () => Promise.resolve(),
    },
    dispatch: {
      register: () => Promise.resolve(),
      offerWork: outage,
      judgeFree: outage,
      judgeLost: () => Promise.resolve(),
      isStopped: () => false,
    },
    grading: { gradingEnd: outage, internalError: outage },
    timings: TIMINGS,
  } as unknown as JudgeHandlerServices;

  beforeEach(async () => {
    unhandled = [];
    process.on('unhandledRejection', record);
    const connected = new Promise<void>((resolve) => {
      server = createServer((socket) => {
        handler = new JudgeHandler(socket, services);
        resolve();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    client = connect((server.address() as { port: number }).port, '127.0.0.1');
    client.on('error', () => undefined);
    await connected;
  });
  afterEach(async () => {
    process.off('unhandledRejection', record);
    client.destroy();
    await handler.finished;
    await new Promise((resolve) => server.close(resolve));
  });

  const send = (packet: Packet) => client.write(encodePacket(packet));
  const connectAs = async () => {
    send({
      name: 'handshake',
      id: 'judge-1',
      key: 'k',
      problems: [],
      executors: {},
    });
    await pause(100);
  };

  it('keeps the connection and leaks no rejection when offering work fails', async () => {
    await connectAs();
    send({ name: 'supported-problems', problems: [] });
    await pause(200);
    expect(handler.isClosed).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('leaks no rejection when freeing the judge and writing the verdict both fail', async () => {
    await connectAs();
    handler.workingOn = 'sub-1';
    send({ name: 'grading-end', 'submission-id': 'sub-1' });
    await pause(200);
    expect(handler.isClosed).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('still closes on a packet for another submission when failing its own submission fails', async () => {
    await connectAs();
    handler.workingOn = 'sub-1';
    send({ name: 'grading-end', 'submission-id': 'other' });
    await handler.finished;
    expect(handler.isClosed).toBe(true);
    expect(handler.workingOn).toBe('sub-1');
    expect(unhandled).toEqual([]);
  });
});
