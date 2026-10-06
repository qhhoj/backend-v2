import { Logger } from '@nestjs/common';
import type { Socket } from 'node:net';
import type { BridgeTimings } from '../bridge-timings';
import type { DispatchTarget } from '../dispatch/dispatch';
import type { DispatchService } from '../dispatch/dispatch.service';
import {
  decodeFrame,
  encodePacket,
  HANDSHAKE_LIMITS,
  JUDGE_LIMITS,
  readFrames,
} from '../protocol/packet-codec';
import type { Packet } from '../protocol/packet-codec';
import {
  parseJudgePacket,
  submissionRequestPacket,
} from '../protocol/judge-packets';
import type {
  HandshakePacket,
  SubmissionPacket,
  SubmissionRequest,
} from '../protocol/judge-packets';
import { ProtocolError } from '../protocol/protocol.error';
import type { GradingService } from '../submissions/grading.service';
import type { JudgesRepository } from './judges.repository';

/** A judge sends a test-case batch every 0.25 s and a ping response every 10 s; far more than this is a flood. */
export const MAX_PACKETS_PER_SECOND = 100;
/** Legacy: the reported ping is the mean of the last 6 round trips. */
const PING_SAMPLES = 6;
const HEADER_BYTES = 4;

export interface JudgeHandlerServices {
  judges: JudgesRepository;
  dispatch: DispatchService;
  grading: GradingService;
  timings: BridgeTimings;
}

/** One judge socket (legacy `JudgeHandler`): framing, the handshake, liveness, and the packets of the submission it works on. Frames are handled one at a time with the socket paused, so a judge cannot fan out writes. */
export class JudgeHandler implements DispatchTarget {
  name = '';
  problems: ReadonlySet<string> = new Set<string>();
  executors: ReadonlySet<string> = new Set<string>();
  isDisabled = false;
  load = Number.POSITIVE_INFINITY;
  workingOn: string | null = null;
  isClosed = false;
  /** Resolves once the close was handled (requeue, offline). */
  readonly finished: Promise<void>;
  private authenticated = false;
  private connectedAt = new Date();
  /** Received bytes not yet framed; joined only once a whole frame has arrived, so a trickled body costs O(size), not O(size × chunks). */
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private lastReceivedAt = Date.now();
  private windowStartedAt = Date.now();
  private packetsInWindow = 0;
  private batchNumber: number | null = null;
  private inBatch = false;
  private readonly roundTrips: number[] = [];
  private readonly handshakeTimer: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private ackTimer?: NodeJS.Timeout;
  private readonly logger = new Logger(JudgeHandler.name);

  constructor(
    private readonly socket: Socket,
    private readonly services: JudgeHandlerServices,
  ) {
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', (error) =>
      this.logger.warn(`${this.label()}: ${error.message}`),
    );
    this.finished = new Promise((resolve) =>
      socket.once('close', () => void this.onClose().finally(resolve)),
    );
    /** Absolute deadline: trickling bytes never extends it (a socket idle timeout would). */
    this.handshakeTimer = setTimeout(
      () => this.close('no handshake in time'),
      services.timings.handshakeMs,
    );
  }

  submit(request: SubmissionRequest): void {
    this.send(submissionRequestPacket(request));
    this.ackTimer = setTimeout(
      () => this.close(`no acknowledgement of ${request.submissionId}`),
      this.services.timings.ackMs,
    );
  }

  terminate(): void {
    this.send({ name: 'terminate-submission' });
  }

  disconnect(force: boolean): void {
    if (force) this.close('force-disconnected');
    else this.send({ name: 'disconnect' });
  }

  private label(): string {
    return this.name || this.socket.remoteAddress || 'judge';
  }

  private send(packet: Packet): void {
    if (!this.isClosed) this.socket.write(encodePacket(packet));
  }

  private close(reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.logger.log(`${this.label()}: closing (${reason})`);
    this.socket.destroy();
  }

  private receive(chunk: Buffer): void {
    this.lastReceivedAt = Date.now();
    this.socket.pause();
    void this.consume(chunk).then(() => {
      if (!this.isClosed) this.socket.resume();
    });
  }

  /** Only a handshake is legitimate before authentication, so only its smaller caps apply. */
  private limits() {
    return this.authenticated ? JUDGE_LIMITS : HANDSHAKE_LIMITS;
  }

  /** Header plus announced body of the frame at the front, or null while fewer than 4 bytes arrived; an oversized header throws here, before any body is buffered. */
  private frameBytesNeeded(): number | null {
    if (this.bufferedBytes < HEADER_BYTES) return null;
    if (this.chunks[0].length < HEADER_BYTES)
      this.chunks = [Buffer.concat(this.chunks)];
    const header = this.chunks[0].subarray(0, HEADER_BYTES);
    readFrames(header, this.limits());
    return HEADER_BYTES + header.readUInt32BE(0);
  }

  private takeFrames(chunk: Buffer): Buffer[] {
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
    const needed = this.frameBytesNeeded();
    if (needed === null || this.bufferedBytes < needed) return [];
    const { frames, rest } = readFrames(
      Buffer.concat(this.chunks),
      this.limits(),
    );
    this.chunks = rest.length ? [rest] : [];
    this.bufferedBytes = rest.length;
    return frames;
  }

  private async consume(chunk: Buffer): Promise<void> {
    try {
      const frames = this.takeFrames(chunk);
      /** Counted on arrival, before any is handled, so the bound does not depend on Mongo latency. */
      frames.forEach(() => this.countPacket());
      for (const frame of frames) {
        if (this.isClosed) return;
        await this.handleSafely(decodeFrame(frame, this.limits()));
      }
    } catch (error) {
      if (error instanceof ProtocolError) this.close(error.message);
      else this.logger.error(`${this.label()}: ${(error as Error).message}`);
    }
  }

  private countPacket(): void {
    const now = Date.now();
    if (now - this.windowStartedAt >= 1000) {
      this.windowStartedAt = now;
      this.packetsInWindow = 0;
    }
    this.packetsInWindow += 1;
    if (this.packetsInWindow > MAX_PACKETS_PER_SECOND)
      throw new ProtocolError('packet flood');
  }

  /** A server-side failure (Mongo, Redis) is logged and the judge kept (legacy: "THIS IS A SERVER"); protocol errors close it. */
  private async handleSafely(packet: Packet): Promise<void> {
    try {
      await this.handle(packet);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      this.logger.error(
        `${this.label()}: ${packet.name} failed: ${(error as Error).message}`,
      );
    }
  }

  private async handle(raw: Packet): Promise<void> {
    /** Gated on the raw name: nothing but a handshake is even parsed before authentication. */
    if (!this.authenticated && raw.name !== 'handshake')
      throw new ProtocolError(`${raw.name} before the handshake`);
    const packet = parseJudgePacket(raw);
    if (!packet)
      return this.logger.warn(
        `${this.label()}: ignoring unknown packet ${raw.name}`,
      );
    switch (packet.name) {
      case 'handshake':
        if (this.authenticated) throw new ProtocolError('second handshake');
        return this.handshake(packet);
      case 'ping-response':
        return this.onPingResponse(packet.when, packet.load);
      case 'supported-problems':
        return this.onSupportedProblems(packet.problems);
      default:
        return this.onSubmissionPacket(packet);
    }
  }

  /** A server-side failure while connecting (Mongo, Redis) closes the connection: the judge reconnects, and no half-registered judge lingers. */
  private async handshake(packet: HandshakePacket): Promise<void> {
    try {
      await this.authenticate(packet);
    } catch (error) {
      this.close('handshake failed');
      throw error;
    }
  }

  private async authenticate(packet: HandshakePacket): Promise<void> {
    const judge = await this.services.judges.authenticate(
      packet.id,
      packet.key,
    );
    if (this.isClosed) return;
    if (!judge) return this.close(`authentication failed for ${packet.id}`);
    clearTimeout(this.handshakeTimer);
    this.authenticated = true;
    this.name = packet.id;
    this.problems = new Set(packet.problems);
    this.executors = new Set(packet.executors);
    this.isDisabled = judge.isDisabled;
    this.connectedAt = new Date();
    this.send({ name: 'handshake-success' });
    await this.services.judges.markOnline(this.name, this.connectedAt, {
      problems: packet.problems,
      runtimes: packet.runtimes,
      lastIp: this.socket.remoteAddress ?? null,
    });
    /** Closed while marking online: `onClose`'s offline write may have landed first and matched nothing. */
    if (this.isClosed)
      return this.services.judges.markOffline(this.name, this.connectedAt);
    this.pingTimer = setInterval(
      () => this.ping(),
      this.services.timings.pingIntervalMs,
    );
    this.ping();
    await this.services.dispatch.register(this);
  }

  private ping(): void {
    if (Date.now() - this.lastReceivedAt > this.services.timings.idleMs)
      return this.close('silent for too long');
    this.send({ name: 'ping', when: Date.now() / 1000 });
  }

  private async onPingResponse(
    when: number,
    load: number | null,
  ): Promise<void> {
    this.roundTrips.push(Date.now() / 1000 - when);
    if (this.roundTrips.length > PING_SAMPLES) this.roundTrips.shift();
    if (load !== null) this.load = load;
    const ping =
      this.roundTrips.reduce((sum, value) => sum + value, 0) /
      this.roundTrips.length;
    await this.services.judges.updatePing(
      this.name,
      this.connectedAt,
      ping,
      load,
    );
  }

  private async onSupportedProblems(problems: string[]): Promise<void> {
    this.problems = new Set(problems);
    await this.services.judges.updateProblems(
      this.name,
      this.connectedAt,
      problems,
    );
    await this.services.dispatch.offerWork(this);
  }

  private async onSubmissionPacket(packet: SubmissionPacket): Promise<void> {
    const { submissionId } = packet;
    if (submissionId !== this.workingOn) return this.rejectForeign(packet.name);
    const { grading } = this.services;
    switch (packet.name) {
      case 'submission-acknowledged':
        return clearTimeout(this.ackTimer);
      case 'grading-begin':
        this.batchNumber = null;
        this.inBatch = false;
        return grading.beginGrading(submissionId, this.name, packet.pretested);
      case 'batch-begin':
        if (this.batchNumber === null)
          await grading.markBatched(submissionId, this.name);
        this.batchNumber = (this.batchNumber ?? 0) + 1;
        this.inBatch = true;
        return;
      case 'batch-end':
        this.inBatch = false;
        return;
      case 'test-case-status': {
        const batch = this.inBatch ? this.batchNumber : null;
        const outcome = await grading.addCases(
          submissionId,
          this.name,
          packet.cases.map((report) => ({ ...report, batch })),
        );
        if (outcome === 'full')
          throw new ProtocolError('more test cases than a submission may have');
        return;
      }
      case 'compile-message':
        return grading.compileMessage(submissionId, this.name, packet.log);
      case 'grading-end':
        return this.finish(() => grading.gradingEnd(submissionId, this.name));
      case 'compile-error':
        return this.finish(() =>
          grading.compileError(submissionId, this.name, packet.log),
        );
      case 'internal-error':
        return this.finish(() =>
          grading.internalError(submissionId, this.name, packet.message),
        );
      case 'submission-terminated':
        return this.finish(() => grading.terminated(submissionId, this.name));
    }
  }

  /** Frees the judge first, like legacy `_free_self`, so the next submission is sent while this result is written. */
  private async finish(write: () => Promise<void>): Promise<void> {
    clearTimeout(this.ackTimer);
    this.batchNumber = null;
    this.inBatch = false;
    /** Caught at once: if `write` throws first, an unobserved rejection would crash the process. */
    const next = this.services.dispatch
      .judgeFree(this)
      .catch((error: Error) =>
        this.logger.error(
          `${this.label()}: offering work failed: ${error.message}`,
        ),
      );
    await write();
    await next;
  }

  /** A packet for a submission this judge is not working on: its own in-flight submission becomes IE and the connection closes; the other submission is never touched (legacy only for wrong acknowledgements). */
  private async rejectForeign(packetName: string): Promise<void> {
    const current = this.workingOn;
    if (current !== null) {
      try {
        await this.services.grading.internalError(
          current,
          this.name,
          `The judge sent ${packetName} for another submission`,
        );
        this.workingOn = null;
      } catch (error) {
        // still working on it: the close below requeues it instead
        this.logger.error(
          `${this.label()}: failing ${current} failed: ${(error as Error).message}`,
        );
      }
    }
    throw new ProtocolError(
      `${packetName} for a submission it is not working on`,
    );
  }

  private async onClose(): Promise<void> {
    this.isClosed = true;
    clearTimeout(this.handshakeTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.ackTimer);
    if (!this.authenticated) return;
    const { dispatch, judges } = this.services;
    try {
      await dispatch.judgeLost(this);
      if (!dispatch.isStopped())
        await judges.markOffline(this.name, this.connectedAt);
    } catch (error) {
      this.logger.error(
        `${this.label()}: cleanup failed: ${(error as Error).message}`,
      );
    }
  }
}
