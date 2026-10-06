import { Inject, Injectable } from '@nestjs/common';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import { DispatchService } from '../dispatch/dispatch.service';
import { GradingService } from '../submissions/grading.service';
import { JudgeHandler } from './judge.handler';
import type { JudgeHandlerServices } from './judge.handler';
import { JudgesRepository } from './judges.repository';

/** Sockets beyond this are refused, which bounds unauthenticated connections. */
export const MAX_JUDGE_CONNECTIONS = 256;
/** Bounds the memory (up to 4 MiB each) one host can pin with sockets that never authenticate; authenticated judges are not counted. The judge port must still be reachable only from judge hosts. */
export const MAX_UNAUTHENTICATED_PER_ADDRESS = 8;

@Injectable()
export class JudgeServerService {
  private server: Server | null = null;
  private readonly handlers = new Set<JudgeHandler>();
  /** Sockets accepted before `acceptJudges`, paused and untouched. */
  private readonly held = new Set<Socket>();
  private services?: JudgeHandlerServices;
  private accepting = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BRIDGE_TIMINGS) private readonly timings: BridgeTimings,
    private readonly judges: JudgesRepository,
    private readonly dispatch: DispatchService,
    private readonly grading: GradingService,
  ) {}

  /** Binds the port and holds whoever connects: a second bridge process fails here, before it touches Mongo, and a judge that connects during start-up waits instead of being dropped (a dropped connection lengthens the judge's reconnect backoff). */
  async listen(): Promise<number> {
    this.services = {
      judges: this.judges,
      dispatch: this.dispatch,
      grading: this.grading,
      timings: this.timings,
    };
    const server = createServer((socket) => this.onConnection(socket));
    server.maxConnections = MAX_JUDGE_CONNECTIONS;
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.env.judgeBridgePort, this.env.judgeBridgeHost, () =>
        resolve(),
      );
    });
    return this.port();
  }

  /** Start-up is done: held connections are served from here on. */
  acceptJudges(): void {
    this.accepting = true;
    const waiting = [...this.held];
    this.held.clear();
    for (const socket of waiting) this.serve(socket);
  }

  private onConnection(socket: Socket): void {
    if (this.accepting) return this.serve(socket);
    socket.pause();
    this.held.add(socket);
    socket.once('close', () => this.held.delete(socket));
  }

  private serve(socket: Socket): void {
    if (
      this.unauthenticatedFrom(socket.remoteAddress) >=
      MAX_UNAUTHENTICATED_PER_ADDRESS
    )
      return void socket.destroy();
    const handler = new JudgeHandler(socket, this.services!);
    this.handlers.add(handler);
    void handler.finished.then(() => this.handlers.delete(handler));
    socket.resume();
  }

  private unauthenticatedFrom(address: string | undefined): number {
    return [...this.handlers].filter(
      (handler) =>
        !handler.isAuthenticated && handler.remoteAddress === address,
    ).length;
  }

  port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  /** Stops accepting, drops every judge and waits until their closes were handled. */
  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    const stopped = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    for (const socket of this.held) socket.destroy();
    const handlers = [...this.handlers];
    for (const handler of handlers) handler.disconnect(true);
    await Promise.all(handlers.map((handler) => handler.finished));
    await stopped;
  }
}
