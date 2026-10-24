import type { Socket } from 'node:net';
import { TIMER_HANDSHAKE_CLOCK } from './handshake-clock';
import type { HandshakeClock } from './handshake-clock';

interface Tracked {
  socket: Socket;
  address: string;
  /** The judge whose session last authenticated on this socket. */
  judge: string | null;
  /** Authenticated sessions still open on this socket, by judge. */
  open: Map<string, number>;
  /** Cancels the deadline, or the delayed destroy once retired. */
  cancelTimer: (() => void) | null;
  isRetiring: boolean;
  openedAt: number;
  /** Destroyed by the deadline rather than closed by either side. */
  timedOut: boolean;
}

/** A socket that closed without any session authenticating on it: a TLS or HTTP/2 handshake that failed or never finished, a refused key, or a probe. */
export interface UnauthenticatedClose {
  address: string;
  aliveMs: number;
  bytesRead: number;
  timedOut: boolean;
}

export interface GuardLimits {
  maxUnauthenticatedPerAddress: number;
  /** A socket with no open authenticated session is destroyed after this (at accept, and again when its last session ends). */
  deadlineMs: number;
  /** A retired socket is destroyed after this, so the statuses of its ended sessions reach the judge first. */
  flushMs: number;
}

/** `address:port` as a socket reports it. */
export const peerOfSocket = (socket: Socket): string =>
  `${socket.remoteAddress ?? ''}:${socket.remotePort ?? 0}`;

/** `address:port` from grpc-js `call.getPeer()`, which brackets IPv6 addresses. */
export const peerOfCall = (peer: string): string =>
  peer.replace(/^\[(.*)\]:(\d+)$/, '$1:$2');

/**
 * The connection caps of decision 87 for sockets handed to grpc-js. A socket with no open authenticated session counts as unauthenticated (at most `maxUnauthenticatedPerAddress` per address) and is destroyed `deadlineMs` after it got there: at accept (a TLS or HTTP/2 handshake that never finishes included) and when its last session ends. A judge keeps one socket: the others are retired when it authenticates elsewhere, and all of them when it is revoked.
 */
export class ConnectionGuard {
  private readonly sockets = new Map<string, Tracked>();
  /** Each judge's socket of its newest session. */
  private readonly newest = new Map<string, Tracked>();

  constructor(
    private readonly limits: GuardLimits,
    private readonly onUnauthenticatedClose: (
      closed: UnauthenticatedClose,
    ) => void = () => undefined,
    private readonly clock: HandshakeClock = TIMER_HANDSHAKE_CLOCK,
  ) {}

  /** False: refuse the socket (the caller destroys it). */
  admit(socket: Socket): boolean {
    const address = socket.remoteAddress ?? '';
    if (
      this.unauthenticatedFrom(address) >=
      this.limits.maxUnauthenticatedPerAddress
    )
      return false;
    const peer = peerOfSocket(socket);
    const tracked: Tracked = {
      socket,
      address,
      judge: null,
      open: new Map(),
      cancelTimer: null,
      isRetiring: false,
      openedAt: Date.now(),
      timedOut: false,
    };
    this.sockets.set(peer, tracked);
    this.armDeadline(tracked);
    socket.once('close', () => this.forget(peer, tracked));
    return true;
  }

  /** A session of `judge` passed the key check on this socket: the deadline is off, a retired socket is kept (the new key is valid), and the judge's other sockets without a session are retired. */
  sessionOpened(peer: string, judge: string): void {
    const tracked = this.sockets.get(peer);
    if (!tracked) return;
    tracked.open.set(judge, (tracked.open.get(judge) ?? 0) + 1);
    tracked.judge = judge;
    tracked.isRetiring = false;
    this.clearTimer(tracked);
    this.newest.set(judge, tracked);
    for (const other of this.socketsOf(judge))
      if (other !== tracked && other.open.size === 0) this.retire(other);
  }

  /** A session on this socket ended: with none left, the socket is retired when a newer socket serves its judge, else it gets `deadlineMs` to open another one. */
  sessionClosed(peer: string, judge: string): void {
    const tracked = this.sockets.get(peer);
    const count = tracked?.open.get(judge);
    if (!tracked || !count) return;
    if (count > 1) tracked.open.set(judge, count - 1);
    else tracked.open.delete(judge);
    if (tracked.open.size > 0 || tracked.isRetiring) return;
    if (tracked.judge && this.newest.get(tracked.judge) !== tracked)
      this.retire(tracked);
    else this.armDeadline(tracked);
  }

  /** Blocked, key rotated or force-disconnected: every socket of the judge is retired, unless another judge has a session open on it. */
  closeJudge(judge: string): void {
    for (const tracked of this.socketsOf(judge))
      if ([...tracked.open.keys()].every((name) => name === judge))
        this.retire(tracked);
  }

  /** Destroys the socket at once (an address over its failed-auth limit). */
  destroy(peer: string): void {
    this.sockets.get(peer)?.socket.destroy();
  }

  unauthenticatedFrom(address: string): number {
    return [...this.sockets.values()].filter(
      (tracked) => tracked.address === address && tracked.open.size === 0,
    ).length;
  }

  private socketsOf(judge: string): Tracked[] {
    return [...this.sockets.values()].filter(
      (tracked) => tracked.judge === judge || tracked.open.has(judge),
    );
  }

  private armDeadline(tracked: Tracked): void {
    this.clearTimer(tracked);
    tracked.cancelTimer = this.clock.arm(
      { peer: peerOfSocket(tracked.socket) },
      this.limits.deadlineMs,
      () => {
        tracked.timedOut = true;
        tracked.socket.destroy();
      },
    );
  }

  private retire(tracked: Tracked): void {
    if (tracked.isRetiring) return;
    tracked.isRetiring = true;
    this.clearTimer(tracked);
    const timer = setTimeout(
      () => tracked.socket.destroy(),
      this.limits.flushMs,
    );
    tracked.cancelTimer = () => clearTimeout(timer);
  }

  private clearTimer(tracked: Tracked): void {
    tracked.cancelTimer?.();
    tracked.cancelTimer = null;
  }

  private forget(peer: string, tracked: Tracked): void {
    this.clearTimer(tracked);
    this.sockets.delete(peer);
    if (!tracked.judge)
      this.onUnauthenticatedClose({
        address: tracked.address,
        aliveMs: Date.now() - tracked.openedAt,
        bytesRead: tracked.socket.bytesRead,
        timedOut: tracked.timedOut,
      });
    if (tracked.judge && this.newest.get(tracked.judge) === tracked)
      this.newest.delete(tracked.judge);
  }
}
