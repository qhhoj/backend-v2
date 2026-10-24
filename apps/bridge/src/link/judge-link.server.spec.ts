import { Metadata, status } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { JudgeMessage } from '@libs/judge-proto';
import type { BridgeMessage } from '@libs/judge-proto';
import { DEFAULT_BRIDGE_TIMINGS } from '../bridge-timings';
import { TIMER_ACCEPT_CLOCK } from './accept-clock';
import { JudgeLinkServer } from './judge-link.server';
import { MAX_FAILED_AUTH_PER_ADDRESS } from './link-limits';

/** The server side of a Session stream: what the link server reads and the status it ends it with. */
class FakeCall extends EventEmitter {
  readonly metadata = new Metadata();
  readonly statuses: Array<{ code: status; details: string }> = [];
  readonly written: BridgeMessage[] = [];
  constructor(name: string, key: string) {
    super();
    this.on('error', () => undefined);
    this.metadata.set('x-judge-name', name);
    this.metadata.set('x-judge-key', key);
  }
  closed = false;
  getPeer = () => '10.0.0.9:5000';
  write = (message: BridgeMessage) => this.written.push(message) > 0;
  pause = () => undefined;
  resume = () => undefined;
  end = () => setImmediate(() => this.emit('close'));
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'error') {
      this.statuses.push(args[0] as { code: status; details: string });
      setImmediate(() => super.emit('close'));
    }
    return super.emit(event, ...args);
  }
}

const IDENTITY = { isDisabled: false, authKeyHash: 'hash' };
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
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A key check the test resolves, so it can act while the check is under way. */
function deferredCheck() {
  let pass: (value: typeof IDENTITY | null) => void = () => undefined;
  const authenticate = jest.fn(
    () => new Promise<typeof IDENTITY | null>((resolve) => (pass = resolve)),
  );
  return { authenticate, pass: (value = IDENTITY) => pass(value) };
}

/** Hello handling up to the Welcome: the online write after it never finishes, so the dispatcher never registers the session. */
const welcomeOnly = {
  dispatch: { resume: () => Promise.resolve({ resume: [], abort: [] }) },
  judges: { markSessionOnline: () => new Promise(() => undefined) },
};

function setup(authenticate: jest.Mock) {
  const server = new JudgeLinkServer(
    {} as never,
    DEFAULT_BRIDGE_TIMINGS,
    TIMER_ACCEPT_CLOCK,
    { authenticate, ...welcomeOnly.judges } as never,
    welcomeOnly.dispatch as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const internals = server as unknown as {
    openSession(call: FakeCall): Promise<void>;
    serve(socket: Socket): void;
    sessions: Set<unknown>;
  };
  const open = (call: FakeCall) => internals.openSession(call);
  return {
    server,
    open,
    serve: (socket: Socket) => internals.serve(socket),
    sessions: internals.sessions,
  };
}

describe('JudgeLinkServer', () => {
  let warned: jest.SpyInstance;
  beforeEach(() => {
    // sessions' Hello timers never fire; settle() still runs
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('refuses a Session whose key check finishes after close() began, and checks none once closing', async () => {
    const check = deferredCheck();
    const { server, open } = setup(check.authenticate);
    const early = new FakeCall('j1', 'key');
    const opening = open(early);
    await server.close();
    check.pass();
    await opening;
    expect(early.statuses).toEqual([
      { code: status.UNAVAILABLE, details: 'the bridge is stopping' },
    ]);
    const late = new FakeCall('j1', 'key');
    await open(late);
    expect(late.statuses[0]?.code).toBe(status.UNAVAILABLE);
    expect(check.authenticate).toHaveBeenCalledTimes(1);
  });

  it('opens no session on a stream that closed during its key check', async () => {
    const check = deferredCheck();
    const { open, sessions } = setup(check.authenticate);
    const dropped = new FakeCall('j1', 'key');
    const opening = open(dropped);
    dropped.closed = true;
    dropped.emit('close');
    check.pass();
    await opening;
    expect(sessions.size).toBe(0);
  });

  it('refuses a Session whose key check was under way when its judge was revoked, and serves one checked after', async () => {
    const check = deferredCheck();
    const { server, open } = setup(check.authenticate);
    const during = new FakeCall('j1', 'key');
    const opening = open(during);
    server.revoke('j1');
    check.pass();
    await opening;
    expect(during.statuses[0]?.code).toBe(status.PERMISSION_DENIED);
    const after = new FakeCall('j1', 'key');
    const reopening = open(after);
    check.pass();
    await reopening;
    expect(after.statuses).toEqual([]);
    server.revoke('j1');
    expect(after.statuses[0]?.code).toBe(status.PERMISSION_DENIED);
  });

  it('sends the forced Disconnect when revoking a welcomed judge the dispatcher has not registered yet, none before the Welcome', async () => {
    const { server, open } = setup(jest.fn(() => Promise.resolve(IDENTITY)));
    const [welcomed, handshaking] = [
      new FakeCall('j1', 'key'),
      new FakeCall('j2', 'key'),
    ];
    for (const call of [welcomed, handshaking]) await open(call);
    welcomed.emit('data', { message: HELLO, bytes: 64 });
    await settle();
    server.revoke('j1');
    server.revoke('j2');
    const kinds = (call: FakeCall) =>
      call.written.map((message) => message.body?.$case);
    expect(kinds(welcomed)).toEqual(['welcome', 'disconnect']);
    expect(kinds(handshaking)).toEqual([]);
    for (const call of [welcomed, handshaking])
      expect(call.statuses[0]?.code).toBe(status.PERMISSION_DENIED);
  });

  it('ends an older Session of the judge still in its handshake when a newer one opens, not another judge', async () => {
    const { open } = setup(jest.fn(() => Promise.resolve(IDENTITY)));
    const [older, otherJudge, newer] = [
      new FakeCall('j1', 'key'),
      new FakeCall('j2', 'key'),
      new FakeCall('j1', 'key'),
    ];
    for (const call of [older, otherJudge, newer]) await open(call);
    expect(older.statuses).toEqual([
      {
        code: status.ABORTED,
        details: 'replaced by a newer session of this judge',
      },
    ]);
    expect([otherJudge.statuses, newer.statuses]).toEqual([[], []]);
  });

  it('logs the first failed key check of an address and its lock-out, never the key, then refuses its sockets', async () => {
    const { open, serve } = setup(jest.fn(() => Promise.resolve(null)));
    for (let attempt = 0; attempt < MAX_FAILED_AUTH_PER_ADDRESS + 2; attempt++)
      await open(new FakeCall('j1', 'secret-key'));
    const lines = warned.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('10.0.0.9');
    expect(lines[0]).toContain('j1');
    expect(lines[1]).toContain(`${MAX_FAILED_AUTH_PER_ADDRESS} key checks`);
    expect(lines.join()).not.toContain('secret-key');
    const socket = Object.assign(new EventEmitter(), {
      remoteAddress: '10.0.0.9',
      remotePort: 6000,
      destroyed: false,
    });
    const destroy = () => (socket.destroyed = true);
    Object.assign(socket, { destroy });
    serve(socket as unknown as Socket);
    expect(socket.destroyed).toBe(true);
    await settle();
  });

  it('does not echo a claimed name that is not a judge name', async () => {
    const { open } = setup(jest.fn(() => Promise.resolve(null)));
    await open(new FakeCall('bad name!', 'key'));
    const [[line]] = warned.mock.calls as string[][];
    expect(line).toContain('(invalid name)');
  });
});
