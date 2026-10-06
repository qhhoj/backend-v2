import { connect } from 'node:net';
import type { Socket } from 'node:net';
import {
  decodeFrame,
  encodePacket,
  JUDGE_LIMITS,
  readFrames,
} from '../src/protocol/packet-codec';
import type { Packet } from '../src/protocol/packet-codec';

/** A raw frame (4-byte big-endian length + body), for hand-built and hostile bytes. */
export const frameOf = (body: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
};

export const DEFAULT_EXECUTORS = {
  CPP17: [['g++', [11, 4]]],
  PY3: [['python', [3, 12]]],
};

/** A judge-server stand-in over real TCP: records every packet the bridge sends, answers pings (load 0.25) unless told not to, and sends whatever a test scripts. */
export class FakeJudge {
  readonly received: Packet[] = [];
  readonly closed: Promise<void>;
  isClosed = false;
  private pending: Buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];

  private constructor(
    private readonly socket: Socket,
    private readonly answerPings: boolean,
  ) {
    this.closed = new Promise((resolve) =>
      socket.once('close', () => {
        this.isClosed = true;
        this.wake();
        resolve();
      }),
    );
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = readFrames(
        Buffer.concat([this.pending, chunk]),
        JUDGE_LIMITS,
      );
      this.pending = rest;
      for (const packet of frames.map((frame) =>
        decodeFrame(frame, JUDGE_LIMITS),
      )) {
        this.received.push(packet);
        if (packet.name === 'ping' && this.answerPings)
          this.send({
            name: 'ping-response',
            when: packet.when,
            time: Date.now() / 1000,
            load: 0.25,
          });
      }
      this.wake();
    });
  }

  static async connect(
    port: number,
    { answerPings = true } = {},
  ): Promise<FakeJudge> {
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve, reject) =>
      socket.once('connect', resolve).once('error', reject),
    );
    return new FakeJudge(socket, answerPings);
  }

  /** Connects and completes the handshake. */
  static async online(
    port: number,
    {
      name,
      key,
      problems = [],
      executors = DEFAULT_EXECUTORS,
      answerPings = true,
    }: {
      name: string;
      key: string;
      problems?: string[];
      executors?: Record<string, unknown>;
      answerPings?: boolean;
    },
  ): Promise<FakeJudge> {
    const judge = await FakeJudge.connect(port, { answerPings });
    judge.send({
      name: 'handshake',
      id: name,
      key,
      problems: problems.map((code) => [code, 0]),
      executors,
    });
    await judge.next('handshake-success');
    return judge;
  }

  send(packet: Packet): void {
    this.socket.write(encodePacket(packet));
  }

  write(bytes: Buffer): void {
    this.socket.write(bytes);
  }

  /** Removes and returns the first received packet named `name`, waiting for it. */
  async next(name: string, timeoutMs = 5000): Promise<Packet> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.received.findIndex((packet) => packet.name === name);
      if (index >= 0) return this.received.splice(index, 1)[0];
      if (this.isClosed) throw new Error(`Closed while waiting for ${name}`);
      if (Date.now() > deadline)
        throw new Error(`No ${name} within ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  close(): Promise<void> {
    this.socket.destroy();
    return this.closed;
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}
