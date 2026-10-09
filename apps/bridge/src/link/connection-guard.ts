import type { Socket } from 'node:net';

interface Tracked {
  address: string;
  authenticated: boolean;
  deadline: NodeJS.Timeout;
}

/** `address:port` as a socket reports it. */
export const peerOfSocket = (socket: Socket): string =>
  `${socket.remoteAddress ?? ''}:${socket.remotePort ?? 0}`;

/** `address:port` from grpc-js `call.getPeer()`, which brackets IPv6 addresses. */
export const peerOfCall = (peer: string): string =>
  peer.replace(/^\[(.*)\]:(\d+)$/, '$1:$2');

/**
 * The connection caps of decision 87 for sockets handed to grpc-js: at most `maxUnauthenticatedPerAddress` sockets per address without an authenticated session, and a socket with none after `deadlineMs` is destroyed (a TLS or HTTP/2 handshake that never finishes counts as unauthenticated).
 */
export class ConnectionGuard {
  private readonly sockets = new Map<string, Tracked>();

  constructor(
    private readonly limits: {
      maxUnauthenticatedPerAddress: number;
      deadlineMs: number;
    },
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
    const deadline = setTimeout(() => socket.destroy(), this.limits.deadlineMs);
    this.sockets.set(peer, { address, authenticated: false, deadline });
    socket.once('close', () => {
      clearTimeout(deadline);
      this.sockets.delete(peer);
    });
    return true;
  }

  /** A session on this socket passed the key check. */
  markAuthenticated(peer: string): void {
    const tracked = this.sockets.get(peer);
    if (!tracked) return;
    tracked.authenticated = true;
    clearTimeout(tracked.deadline);
  }

  unauthenticatedFrom(address: string): number {
    return [...this.sockets.values()].filter(
      (tracked) => tracked.address === address && !tracked.authenticated,
    ).length;
  }
}
