import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { ConnectionGuard, peerOfCall } from './connection-guard';

let ports = 40000;
const fakeSocket = (address: string) => {
  const socket = new EventEmitter() as EventEmitter & {
    remoteAddress: string;
    remotePort: number;
    destroyed: boolean;
    destroy: () => void;
  };
  socket.remoteAddress = address;
  socket.remotePort = ports += 1;
  socket.destroyed = false;
  socket.destroy = () => {
    socket.destroyed = true;
    socket.emit('close');
  };
  return socket;
};
const asSocket = (socket: ReturnType<typeof fakeSocket>) =>
  socket as unknown as Socket;

describe('ConnectionGuard', () => {
  let guard: ConnectionGuard;
  beforeEach(() => {
    jest.useFakeTimers();
    guard = new ConnectionGuard({
      maxUnauthenticatedPerAddress: 2,
      deadlineMs: 15_000,
    });
  });
  afterEach(() => jest.useRealTimers());

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

  it('lets an address open a new socket while its authenticated judge stays connected', () => {
    const judge = fakeSocket('10.0.0.4');
    guard.admit(asSocket(judge));
    guard.markAuthenticated(`10.0.0.4:${judge.remotePort}`);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.4')))).toBe(true);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.4')))).toBe(true);
    expect(guard.admit(asSocket(fakeSocket('10.0.0.4')))).toBe(false);
  });

  it('does not count a socket whose session authenticated, and never destroys it', () => {
    const judge = fakeSocket('10.0.0.7');
    guard.admit(asSocket(judge));
    guard.markAuthenticated(`10.0.0.7:${judge.remotePort}`);
    expect(guard.unauthenticatedFrom('10.0.0.7')).toBe(0);
    jest.advanceTimersByTime(60_000);
    expect(judge.destroyed).toBe(false);
  });

  it('ignores an authentication mark for a peer it does not hold', () => {
    const silent = fakeSocket('10.0.0.3');
    guard.admit(asSocket(silent));
    guard.markAuthenticated('10.0.0.3:1');
    jest.advanceTimersByTime(15_000);
    expect(silent.destroyed).toBe(true);
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

  it('reads a grpc-js peer in the socket format, IPv6 included', () => {
    expect(peerOfCall('127.0.0.1:5000')).toBe('127.0.0.1:5000');
    expect(peerOfCall('[::1]:5000')).toBe('::1:5000');
  });
});
