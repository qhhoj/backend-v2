import { Server, status } from '@grpc/grpc-js';
import type {
  ConnectionInjector,
  ServerOptions,
  StatusObject,
} from '@grpc/grpc-js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createServer } from 'node:net';
import type { AddressInfo, Server as NetServer, Socket } from 'node:net';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { JudgeLinkService } from '@libs/judge-proto';
import { BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import { DispatcherService } from '../dispatch/dispatcher.service';
import { JudgesRepository } from '../judges/judges.repository';
import { RunsService } from '../submissions/runs.service';
import { AuthFailures } from './auth-failures';
import { ConnectionGuard, peerOfCall } from './connection-guard';
import { addressOf, authenticateCall, loggableNameOf } from './judge-auth';
import { JudgeSession } from './judge-session';
import type {
  JudgeIdentity,
  SessionCall,
  SessionServices,
} from './judge-session';
import {
  FAILED_AUTH_WINDOW_MS,
  MAX_FAILED_AUTH_PER_ADDRESS,
  MAX_JUDGE_CONNECTIONS,
  MAX_MESSAGE_BYTES,
  MAX_SLOTS,
  MAX_UNAUTHENTICATED_PER_ADDRESS,
  SOCKET_FLUSH_MS,
} from './link-limits';
import { decodeJudgeMessage } from './messages';
import { serverCredentials } from './server-credentials';
import { SourceFetch } from './source-fetch';
import type { SourceCall } from './source-fetch';

const SERVER_OPTIONS: ServerOptions = {
  'grpc.max_receive_message_length': MAX_MESSAGE_BYTES,
  'grpc.max_send_message_length': MAX_MESSAGE_BYTES,
  /** One Session plus a FetchSource per slot. */
  'grpc.max_concurrent_streams': 1 + MAX_SLOTS,
  'grpc.keepalive_time_ms': 30_000,
  'grpc.keepalive_timeout_ms': 10_000,
  /** judge-v2 pings every 10 s (core Task 26); without these grpc-js answers GOAWAY `too_many_pings` (preflight M3). */
  'grpc.http2.min_ping_interval_without_data_ms': 5_000,
  'grpc.keepalive_permit_without_calls': 1,
};

/** The Session RPC keeps each message's encoded size, for the Hello cap. */
const LINK_SERVICE = {
  ...JudgeLinkService,
  session: {
    ...JudgeLinkService.session,
    requestDeserialize: decodeJudgeMessage,
  },
};

/** How long a stopping bridge lets judges read their final status. */
const CLOSE_GRACE_MS = 1000;
const REVOKED = 'blocked, key rotated or disconnected by an admin';
const STOPPING = 'the bridge is stopping';

type AuthenticatedCall = Pick<SessionCall, 'metadata' | 'getPeer' | 'emit'>;

/** The judge port: a TCP server with the connection caps of decision 87 whose sockets are handed to grpc-js (TLS unless loopback); `Session` streams become `JudgeSession`s (one handshake per judge), `FetchSource` serves held runs' files, an address with too many failed key checks is locked out, and a revoked judge loses its sessions and sockets. */
@Injectable()
export class JudgeLinkServer {
  private readonly logger = new Logger(JudgeLinkServer.name);
  private readonly grpc = new Server(SERVER_OPTIONS);
  private readonly guard: ConnectionGuard;
  private readonly sessions = new Set<JudgeSession>();
  /** Sockets accepted before `acceptJudges`, paused and untouched. */
  private readonly held = new Set<Socket>();
  private readonly services: SessionServices;
  private injector: ConnectionInjector | null = null;
  private tcp: NetServer | null = null;
  private accepting = false;
  private closing = false;
  private readonly failures = new AuthFailures({
    maxPerWindow: MAX_FAILED_AUTH_PER_ADDRESS,
    windowMs: FAILED_AUTH_WINDOW_MS,
  });
  /** Bumped by each `revoke`; per judge, the value its last revoke set. A key check that started before it is refused. */
  private revision = 0;
  private readonly revokedAt = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BRIDGE_TIMINGS) timings: BridgeTimings,
    private readonly judges: JudgesRepository,
    private readonly dispatch: DispatcherService,
    runs: RunsService,
    private readonly sources: SourceFetch,
  ) {
    this.services = { dispatch, runs, judges, timings };
    this.guard = new ConnectionGuard({
      maxUnauthenticatedPerAddress: MAX_UNAUTHENTICATED_PER_ADDRESS,
      deadlineMs: timings.handshakeMs,
      flushMs: SOCKET_FLUSH_MS,
    });
  }

  /** Binds the port and holds whoever connects: a second bridge process fails here, before it touches Mongo, and a judge that connects during start-up waits instead of being dropped. A non-loopback host without TLS refuses to start. */
  async listen(): Promise<number> {
    const credentials = await serverCredentials(this.env);
    this.grpc.addService(LINK_SERVICE, {
      session: (call: SessionCall) => void this.openSession(call),
      fetchSource: (call: SourceCall) => void this.fetchSource(call),
    });
    this.injector = this.grpc.createConnectionInjector(credentials);
    const tcp = createServer((socket) => this.onSocket(socket));
    tcp.maxConnections = MAX_JUDGE_CONNECTIONS;
    this.tcp = tcp;
    await new Promise<void>((resolve, reject) => {
      tcp.once('error', reject);
      tcp.listen(this.env.judgeBridgePort, this.env.judgeBridgeHost, () =>
        resolve(),
      );
    });
    return this.port();
  }

  /** Start-up is done: held sockets are served from here on. */
  acceptJudges(): void {
    this.accepting = true;
    const waiting = [...this.held];
    this.held.clear();
    for (const socket of waiting) this.serve(socket);
  }

  port(): number {
    return (this.tcp?.address() as AddressInfo | null)?.port ?? 0;
  }

  /** Stops accepting, ends every session with UNAVAILABLE and waits until their ends were handled. */
  async close(): Promise<void> {
    this.closing = true;
    const tcp = this.tcp;
    this.tcp = null;
    if (!tcp) return;
    const stopped = new Promise<void>((resolve) => tcp.close(() => resolve()));
    for (const socket of this.held) socket.destroy();
    const sessions = [...this.sessions];
    for (const session of sessions) session.end(status.UNAVAILABLE, STOPPING);
    await Promise.all(sessions.map((session) => session.finished));
    // GOAWAY, then the sockets close once the statuses above are flushed
    this.injector?.drain(CLOSE_GRACE_MS);
    await stopped;
    this.injector?.destroy();
    this.grpc.forceShutdown();
  }

  /** Blocked, key rotated or force-disconnected (after the dispatcher told its registered session): every session of the judge ends, those still in their handshake too, a key check already under way is refused, and its sockets close once the statuses are out. */
  revoke(name: string): void {
    this.revision += 1;
    this.revokedAt.set(name, this.revision);
    for (const session of this.sessions)
      if (session.name === name) session.end(status.PERMISSION_DENIED, REVOKED);
    this.guard.closeJudge(name);
  }

  private onSocket(socket: Socket): void {
    if (this.accepting) return this.serve(socket);
    socket.pause();
    this.held.add(socket);
    socket.once('close', () => this.held.delete(socket));
  }

  private serve(socket: Socket): void {
    const locked = this.failures.isLocked(socket.remoteAddress ?? '');
    if (locked || !this.guard.admit(socket)) return void socket.destroy();
    socket.resume();
    this.injector!.injectConnection(socket);
  }

  private async openSession(call: SessionCall): Promise<void> {
    const peer = peerOfCall(call.getPeer());
    const identity = await this.identify(call, peer);
    if (!identity) return;
    const session = new JudgeSession(call, identity, this.services);
    this.guard.sessionOpened(peer, session.name);
    this.endOlderHandshakes(session);
    this.sessions.add(session);
    void session.finished.then(() => {
      this.sessions.delete(session);
      this.guard.sessionClosed(peer, session.name);
    });
  }

  /** One handshake per judge: an older session of the judge that has not said Hello ends now. A helloed one is replaced by the dispatcher at the newer session's Hello (Disconnect, ABORTED, its runs move over), as the protocol's session rules require. */
  private endOlderHandshakes(newer: JudgeSession): void {
    for (const session of this.sessions)
      if (session.name === newer.name && !session.hasHelloed)
        session.end(
          status.ABORTED,
          'replaced by a newer session of this judge',
        );
  }

  private async fetchSource(call: SourceCall): Promise<void> {
    const identity = await this.identify(call, peerOfCall(call.getPeer()));
    if (identity)
      await this.sources.serve(call, this.dispatch.sessionOf(identity.name));
  }

  /** Null after refusing the call: UNAVAILABLE while the bridge stops, UNAUTHENTICATED for bad credentials, PERMISSION_DENIED when the judge was revoked during the check. */
  private async identify(
    call: AuthenticatedCall,
    peer: string,
  ): Promise<JudgeIdentity | null> {
    if (this.closing) return refuse(call, status.UNAVAILABLE, STOPPING);
    const startedAt = this.revision;
    const identity = await this.checkKey(call, peer);
    if (!identity) return null;
    if (this.closing) return refuse(call, status.UNAVAILABLE, STOPPING);
    if ((this.revokedAt.get(identity.name) ?? 0) > startedAt)
      return refuse(call, status.PERMISSION_DENIED, REVOKED);
    return identity;
  }

  /** UNAVAILABLE when the check itself failed (Mongo). */
  private async checkKey(
    call: AuthenticatedCall,
    peer: string,
  ): Promise<JudgeIdentity | null> {
    let identity: JudgeIdentity | null;
    try {
      identity = await authenticateCall(
        call.metadata,
        this.judges,
        addressOf(peer),
      );
    } catch (error) {
      this.logger.error(
        `Authenticating ${peer} failed: ${(error as Error).message}`,
      );
      return refuse(call, status.UNAVAILABLE, 'try again');
    }
    if (identity) return identity;
    this.keyCheckFailed(call, peer);
    return refuse(
      call,
      status.UNAUTHENTICATED,
      'unknown judge, wrong key or blocked',
    );
  }

  /** Logs the first failure of an address's window and the lock-out (never the key); a locked-out address loses the socket. */
  private keyCheckFailed(call: AuthenticatedCall, peer: string): void {
    const address = addressOf(peer);
    const count = this.failures.record(address);
    const name = loggableNameOf(call.metadata);
    if (count === 1)
      this.logger.warn(`Judge key check failed from ${address} (${name})`);
    if (count < MAX_FAILED_AUTH_PER_ADDRESS) return;
    if (count === MAX_FAILED_AUTH_PER_ADDRESS)
      this.logger.warn(
        `${address} failed ${count} key checks (last: ${name}); refused until ${FAILED_AUTH_WINDOW_MS / 1000} s after its first failure`,
      );
    this.guard.destroy(peer);
  }
}

const refuse = (
  call: AuthenticatedCall,
  code: status,
  details: string,
): null => {
  call.emit('error', { code, details } satisfies Partial<StatusObject>);
  return null;
};
