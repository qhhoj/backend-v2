import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { ConnectionGuard, peerOfCall } from './connection-guard';
import type { UnauthenticatedClose } from './connection-guard';

let ports = 40000;
const fakeSocket = (address: string) => {
  const socket = new EventEmitter() as EventEmitter & {
    remoteAddress: string;
    remotePort: number;
    destroyed: boolean;
    destroy: () => void;
    bytesRead: number;
  };
  socket.remoteAddress = address;
  socket.remotePort = ports += 1;
  socket.destroyed = false;
  socket.bytesRead = 0;
  socket.destroy = () => {
    socket.destroyed = true;
    socket.emit('close');
  };
  return socket;
};
const asSocket = (socket: ReturnType<typeof fakeSocket>) =>
  socket as unknown as Socket;

const peerOf = (socket: ReturnType<typeof fakeSocket>) =>
  `${socket.remoteAddress}:${socket.remotePort}`;

describe('ConnectionGuard', () => {
  let guard: ConnectionGuard;
  beforeEach(() => {
    jest.useFakeTimers();
    guard = new ConnectionGuard({
      maxUnauthenticatedPerAddress: 2,
      deadlineMs: 15_000,
      flushMs: 1000,
    });
  });
  afterEach(() => jest.useRealTimers());

  /** An admitted socket with one open session of `judge`. */
  const withSession = (address: string, judge: string) => {
    const socket = fakeSocket(address);
    guard.admit(asSocket(socket));
    guard.sessionOpened(peerOf(socket), judge);
    return socket;
  };

  it('refuses a third unauthenticated socket from one address, not from another, and frees the slot on close', () => {
    const [first, second] = [fakeSocket('10.0.0.5'), fakeSocket('10.0.0.5')];
    expect(guard.admit(asSocket(first))).toBe(true);
    expect(guard.admit(asSocket(second))).toBe(true);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.5')))).toBe(false);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.6')))).toBe(true);
    first.emit('close');
    expect(guard.admit(asSocket(fakeSocket('10.0.0.5')))).toBe(true);
  });

  it('keeps a flood of refused sockets from filling the table, so the held slots free exactly on close', () => {
    const held = [fakeSocket('10.0.0.9'), fakeSocket('10.0.0.9')];
    held.forEach((socket) => guard.admit(asSocket(socket)));
    for (let attempt = 0; attempt < 50; attempt += 1)
      expect(guard.admit(asSocket(fakeSocket('10.0.0.9')))).toBe(false);
    expect(guard.unauthenticatedFrom('10.0.0.9')).toBe(2);
    held[0].emit('close');
    expect(guard.unauthenticatedFrom('10.0.0.9')).toBe(1);
  });

  it('lets an address open a new socket while its judge has a session open', () => {
    withSession('10.0.0.4', 'j1');
    expect(guard.admit(asSocket(fakeSocket('10.0.0.4')))).toBe(true);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.4')))).toBe(true);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.4')))).toBe(false);
  });

  it('does not count a socket while a session is open on it, and does not destroy it', () => {
    const judge = withSession('10.0.0.7', 'j1');
    expect(guard.unauthenticatedFrom('10.0.0.7')).toBe(0);
    jest.advanceTimersByTime(60_000);
    expect(judge.destroyed).toBe(false);
  });

  it('destroys a socket with no authenticated session at the deadline, however much it sent', () => {
    const silent = fakeSocket('10.0.0.8');
    guard.admit(asSocket(silent));
    jest.advanceTimersByTime(14_999);
    expect(silent.destroyed).toBe(false);
    jest.advanceTimersByTime(1);
    expect(silent.destroyed).toBe(true);
    expect(guard.unauthenticatedFrom('10.0.0.8')).toBe(0);
  });

  it('counts a socket whose last session ended as unauthenticated again and destroys it a deadline later', () => {
    const judge = withSession('10.0.0.7', 'j1');
    guard.sessionOpened(peerOf(judge), 'j1');
    jest.advanceTimersByTime(60_000);
    guard.sessionClosed(peerOf(judge), 'j1');
    jest.advanceTimersByTime(60_000);
    expect(judge.destroyed).toBe(false);
    guard.sessionClosed(peerOf(judge), 'j1');
    expect(guard.unauthenticatedFrom('10.0.0.7')).toBe(1);
    jest.advanceTimersByTime(14_999);
    expect(judge.destroyed).toBe(false);
    jest.advanceTimersByTime(1);
    expect(judge.destroyed).toBe(true);
  });

  it('keeps one socket per judge: a session elsewhere retires its idle socket, and a replaced one goes when its session ends', () => {
    const idle = withSession('10.0.0.2', 'j1');
    guard.sessionClosed(peerOf(idle), 'j1');
    const busy = withSession('10.0.0.2', 'j1');
    jest.advanceTimersByTime(1000);
    expect(idle.destroyed).toBe(true);
    const newest = withSession('10.0.0.2', 'j1');
    jest.advanceTimersByTime(60_000);
    expect(busy.destroyed).toBe(false);
    guard.sessionClosed(peerOf(busy), 'j1');
    jest.advanceTimersByTime(1000);
    expect(busy.destroyed).toBe(true);
    expect(newest.destroyed).toBe(false);
  });

  it('retires every socket of a revoked judge after the flush delay, sparing other judges and a socket another judge has a session on', () => {
    const shared = withSession('10.0.0.1', 'j1');
    guard.sessionOpened(peerOf(shared), 'j2');
    const other = withSession('10.0.0.1', 'j2');
    const busy = withSession('10.0.0.1', 'j1');
    const idle = withSession('10.0.0.1', 'j1');
    guard.sessionClosed(peerOf(idle), 'j1');
    guard.closeJudge('j1');
    jest.advanceTimersByTime(999);
    expect([busy.destroyed, idle.destroyed]).toEqual([false, false]);
    jest.advanceTimersByTime(1);
    expect([busy.destroyed, idle.destroyed]).toEqual([true, true]);
    expect([shared.destroyed, other.destroyed]).toEqual([false, false]);
  });

  it('keeps a retired socket on which a session authenticates again (the new key)', () => {
    const judge = withSession('10.0.0.1', 'j1');
    guard.closeJudge('j1');
    guard.sessionClosed(peerOf(judge), 'j1');
    guard.sessionOpened(peerOf(judge), 'j1');
    jest.advanceTimersByTime(60_000);
    expect(judge.destroyed).toBe(false);
  });

  it('reports a socket that closes or times out with no authenticated session, never one a judge authenticated on', () => {
    const closes: UnauthenticatedClose[] = [];
    guard = new ConnectionGuard(
      { maxUnauthenticatedPerAddress: 2, deadlineMs: 15_000, flushMs: 1000 },
      (closed) => void closes.push(closed),
    );
    const refusedTls = fakeSocket('10.0.0.7');
    guard.admit(asSocket(refusedTls));
    jest.advanceTimersByTime(40);
    refusedTls.emit('close');
    guard.admit(asSocket(fakeSocket('10.0.0.8')));
    jest.advanceTimersByTime(15_000);
    const judge = withSession('10.0.0.9', 'j1');
    guard.sessionClosed(peerOf(judge), 'j1');
    judge.emit('close');
    expect(closes).toEqual([
      { address: '10.0.0.7', aliveMs: 40, bytesRead: 0, timedOut: false },
      { address: '10.0.0.8', aliveMs: 15_000, bytesRead: 0, timedOut: true },
    ]);
  });

  it('reads a grpc-js peer in the socket format, IPv6 included', () => {
    expect(peerOfCall('127.0.0.1:5000')).toBe('127.0.0.1:5000');
    expect(peerOfCall('[::1]:5000')).toBe('::1:5000');
  });
});
