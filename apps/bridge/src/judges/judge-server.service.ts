import { Inject, Injectable } from '@nestjs/common';
import { createServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import { DispatchService } from '../dispatch/dispatch.service';
import { GradingService } from '../submissions/grading.service';
import { JudgeHandler } from './judge.handler';
import { JudgesRepository } from './judges.repository';

/** Sockets beyond this are refused, which bounds unauthenticated connections. */
export const MAX_JUDGE_CONNECTIONS = 256;
/** Bounds the memory (up to 4 MiB each) one host can pin with sockets that never authenticate; authenticated judges are not counted. The judge port must still be reachable only from judge hosts. */
export const MAX_UNAUTHENTICATED_PER_ADDRESS = 8;

@Injectable()
export class JudgeServerService {
  private server: Server | null = null;
  private readonly handlers = new Set<JudgeHandler>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BRIDGE_TIMINGS) private readonly timings: BridgeTimings,
    private readonly judges: JudgesRepository,
    private readonly dispatch: DispatchService,
    private readonly grading: GradingService,
  ) {}

  async listen(): Promise<number> {
    const services = {
      judges: this.judges,
      dispatch: this.dispatch,
      grading: this.grading,
      timings: this.timings,
    };
    const server = createServer((socket) => {
      if (
        this.unauthenticatedFrom(socket.remoteAddress) >=
        MAX_UNAUTHENTICATED_PER_ADDRESS
      )
        return void socket.destroy();
      const handler = new JudgeHandler(socket, services);
      this.handlers.add(handler);
      void handler.finished.then(() => this.handlers.delete(handler));
    });
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
    const handlers = [...this.handlers];
    for (const handler of handlers) handler.disconnect(true);
    await Promise.all(handlers.map((handler) => handler.finished));
    await stopped;
  }
}
