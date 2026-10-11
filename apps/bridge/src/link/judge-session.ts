import { status } from '@grpc/grpc-js';
import type { ServerDuplexStream } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { newId } from '@libs/database';
import {
  BridgeMessage,
  ErrorCode,
  PROTOCOL_MINOR,
  Resume_Action,
} from '@libs/judge-proto';
import type {
  AssignmentRef,
  Final,
  JudgeError,
  JudgeMessage,
  Pong,
} from '@libs/judge-proto';
import type { BridgeTimings } from '../bridge-timings';
import type { DispatcherService } from '../dispatch/dispatcher.service';
import { windingKey } from '../dispatch/slots';
import type { DispatchTarget } from '../dispatch/slots';
import type { JudgesRepository } from '../judges/judges.repository';
import type { AssignRequest } from '../submissions/assign-request';
import type { RunsService } from '../submissions/runs.service';
import type { RunKey, WriteOutcome } from '../submissions/write-outcome';
import { MAX_LOG_BYTES, MAX_MESSAGES_PER_SECOND } from './link-limits';
import { MessageRate } from './message-rate';
import {
  caseRowsOf,
  clipBytes,
  finalReportOf,
  helloOf,
  loggableText,
  refOf,
  seqOf,
} from './messages';
import type { DecodedJudgeMessage, FinalReport, HelloInfo } from './messages';
import { assignOf, limitsOf } from './outbound';
import { flood, ProtocolError, seqGap } from './protocol-error';

/** Legacy: the reported ping is the mean of the last 6 round trips. */
const PING_SAMPLES = 6;
/** Runs a session remembers as ended or aborted (a Final resent before its ack, a late Accepted, a second Abort): enough for any replay window, bounded for a session that lives for weeks. */
const RUNS_REMEMBERED = 1024;

/** What a judge message was about, for a server-side failure's log line: the run, generation and seq of a run message. */
function messageContext(body: JudgeMessage['body']): string {
  if (!body) return 'an empty message';
  const inner = (body as Record<string, unknown>)[body.$case] as {
    ref?: AssignmentRef;
    seq?: number;
  };
  const ref = inner?.ref;
  if (!ref) return body.$case;
  const seq = typeof inner.seq === 'number' ? ` seq ${inner.seq}` : '';
  return `${body.$case} of submission ${ref.submissionId} gen ${ref.generation}${seq}`;
}

/** Adds `key`, forgetting the oldest beyond `RUNS_REMEMBERED` (a Set keeps insertion order). */
function remember(keys: Set<string>, key: string): void {
  keys.add(key);
  if (keys.size <= RUNS_REMEMBERED) return;
  const [oldest] = keys;
  keys.delete(oldest);
}

export type SessionCall = ServerDuplexStream<
  DecodedJudgeMessage,
  BridgeMessage
>;
type Body = NonNullable<JudgeMessage['body']>;
type RunBody = Extract<
  Body,
  { $case: 'accepted' | 'compiled' | 'started' | 'cases' | 'final' }
>;
type BridgeBody = NonNullable<BridgeMessage['body']>;

export interface SessionServices {
  dispatch: DispatcherService;
  runs: RunsService;
  judges: JudgesRepository;
  timings: BridgeTimings;
}

/** Who opened the session, as the key check found it. */
export interface JudgeIdentity {
  name: string;
  isDisabled: boolean;
  authKeyHash: string;
  address: string | null;
}

/** A run message the session holds the ref of, and how its write went. */
interface Handled {
  ref: AssignmentRef;
  outcome: WriteOutcome;
}

/** One judge's `Session` stream: Hello first, liveness, the flood cap, one message handled at a time (the stream is paused meanwhile, so HTTP/2 flow control pushes back on the judge), an ack per stored message, and Assign/Abort/Disconnect from the dispatcher. */
export class JudgeSession implements DispatchTarget {
  readonly id = newId();
  readonly name: string;
  readonly authKeyHash: string;
  readonly inFlight = new Map<string, number>();
  /** Runs the dispatcher let go of that the judge has not ended yet (`windingKey`s); they keep a slot until their `Final`. */
  readonly winding = new Set<string>();
  readonly finished: Promise<void>;
  isDisabled: boolean;
  isDraining = false;
  isClosed = false;
  slots = 0;
  executors: ReadonlySet<string> = new Set<string>();
  private readonly logger = new Logger(JudgeSession.name);
  private helloed = false;
  private readonly connectedAt = new Date();
  private lastReceivedAt = Date.now();
  private isHandling = false;
  private readonly rate = new MessageRate(MAX_MESSAGES_PER_SECOND);
  private nonce = 0;
  private readonly pingsSent = new Map<number, number>();
  private readonly roundTrips: number[] = [];
  /** Accept clocks of assigned runs, by `windingKey`. */
  private readonly acceptTimers = new Map<string, NodeJS.Timeout>();
  /** Refs this session sent an Abort for (`windingKey`s, oldest first). */
  private readonly aborted = new Set<string>();
  /** `windingKey`s of runs whose Final this session stored (or found stored) and acked, oldest first. */
  private readonly ended = new Set<string>();
  private readonly helloTimer: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  /** Why the stream ended, for the disconnect line: the bridge's reason, or the stream error. */
  private closeReason: string | null = null;

  constructor(
    private readonly call: SessionCall,
    private readonly identity: JudgeIdentity,
    private readonly services: SessionServices,
  ) {
    this.name = identity.name;
    this.authKeyHash = identity.authKeyHash;
    this.isDisabled = identity.isDisabled;
    call.on('data', (decoded: DecodedJudgeMessage) => this.receive(decoded));
    call.on('end', () => this.end(status.OK, 'the judge ended its stream'));
    call.on('error', (error: Error) => {
      this.closeReason ??= error.message;
      this.logger.debug(`${this.name}: ${error.message}`);
    });
    this.finished = new Promise((resolve) =>
      call.once('close', () => void this.onClose().finally(resolve)),
    );
    this.helloTimer = setTimeout(
      () => this.end(status.DEADLINE_EXCEEDED, 'no Hello in time'),
      services.timings.handshakeMs,
    );
  }

  assign(request: AssignRequest): void {
    this.send({ $case: 'assign', assign: assignOf(request) });
    const { ref } = request;
    this.acceptTimers.set(
      windingKey(ref),
      setTimeout(
        () => void this.acceptTimedOut(ref),
        this.services.timings.acceptMs,
      ),
    );
  }

  abort(ref: AssignmentRef): void {
    remember(this.aborted, windingKey(ref));
    this.clearAcceptTimer(ref);
    this.send({ $case: 'abort', abort: { ref } });
  }

  disconnect({
    isForced,
    reason,
  }: {
    isForced: boolean;
    reason: string;
  }): void {
    this.send({
      $case: 'disconnect',
      disconnect: { forced: isForced, reason },
    });
    if (isForced) this.end(status.PERMISSION_DENIED, reason);
  }

  replaced(): void {
    const reason = 'replaced by a newer session of this judge';
    this.send({ $case: 'disconnect', disconnect: { forced: false, reason } });
    this.end(status.ABORTED, reason);
  }

  /** Hello was read: from here on the dispatcher decides about replacing this session. */
  get hasHelloed(): boolean {
    return this.helloed;
  }

  holds(ref: AssignmentRef): boolean {
    return this.inFlight.get(ref.submissionId) === ref.generation;
  }

  /** Ends the stream with `code` (OK: a clean end); a protocol error sends its BridgeError first. Idempotent. */
  end(code: status, details: string, error?: ErrorCode): void {
    if (this.isClosed) return;
    if (error !== undefined)
      this.send({ $case: 'error', error: { code: error, message: details } });
    this.isClosed = true;
    this.closeReason ??= details;
    if (code === status.OK) this.call.end();
    else this.call.emit('error', { code, details });
  }

  private send(body: BridgeBody): void {
    if (!this.isClosed) this.call.write(BridgeMessage.fromPartial({ body }));
  }

  private receive(decoded: DecodedJudgeMessage): void {
    this.lastReceivedAt = Date.now();
    if (!this.withinRate()) return;
    this.isHandling = true;
    this.call.pause();
    void this.handleSafely(decoded).finally(() => {
      /** Handling time is not silence: the idle clock restarts when the judge may speak again. */
      this.isHandling = false;
      this.lastReceivedAt = Date.now();
      if (!this.isClosed) this.call.resume();
    });
  }

  /** Counted on arrival, before any is handled, so the bound does not depend on Mongo latency. */
  private withinRate(): boolean {
    if (this.rate.admit()) return true;
    const error = flood();
    this.end(error.grpcStatus, error.message, error.code);
    return false;
  }

  /** A protocol error ends the session; a server-side failure (Mongo, Redis) is logged and the judge kept (legacy: "THIS IS A SERVER"), except during Hello. */
  private async handleSafely(decoded: DecodedJudgeMessage): Promise<void> {
    try {
      await this.handle(decoded);
    } catch (error) {
      if (error instanceof ProtocolError)
        return this.end(error.grpcStatus, error.message, error.code);
      this.logger.error(
        `Judge ${this.name}: handling ${messageContext(decoded.message.body)} failed: ${(error as Error).message}`,
      );
    }
  }

  private async handle({ message, bytes }: DecodedJudgeMessage): Promise<void> {
    const body = message.body;
    if (this.isClosed) return;
    if (!this.helloed) {
      if (body?.$case !== 'hello')
        throw new ProtocolError(
          `${body?.$case ?? 'an empty message'} before Hello`,
        );
      return this.onHello(helloOf(body.hello, bytes));
    }
    if (!body) return;
    switch (body.$case) {
      case 'hello':
        throw new ProtocolError('a second Hello');
      case 'pong':
        return this.onPong(body.pong);
      case 'error':
        return this.onJudgeError(body.error);
      case 'draining':
        this.isDraining = true;
        return;
      default:
        await this.onRunMessage(body);
    }
  }

  private async onHello(info: HelloInfo): Promise<void> {
    clearTimeout(this.helloTimer);
    this.helloed = true;
    this.slots = info.slots;
    this.executors = new Set(info.runtimes.map((runtime) => runtime.language));
    try {
      await this.welcome(info);
    } catch (error) {
      this.end(status.UNAVAILABLE, 'Hello could not be handled');
      throw error;
    }
    if (this.isClosed) return;
    this.pingTimer = setInterval(
      () => this.ping(),
      this.services.timings.pingIntervalMs,
    );
    this.ping();
    // outside the `try`: a failed dispatch must not drop a judge that is fully set up
    await this.services.dispatch.register(this);
  }

  /** Resume decisions, Welcome, the aborts recorded during the grace, then the admin row. */
  private async welcome(info: HelloInfo): Promise<void> {
    const { dispatch, judges, timings } = this.services;
    const plan = await dispatch.resume(this, info.inFlight);
    // replaced while resuming: the newer session owns the admin row
    if (this.isClosed) return;
    this.send({
      $case: 'welcome',
      welcome: {
        sessionId: this.id,
        protocolMinor: Math.min(info.protocolMinor, PROTOCOL_MINOR),
        resume: plan.resume,
        limits: limitsOf(timings),
        pingIntervalMs: timings.pingIntervalMs,
      },
    });
    for (const ref of plan.abort) this.abort(ref);
    const { slots, build, protocolMinor, features, runtimes } = info;
    const resumed = plan.resume.filter(
      ({ action }) => action === Resume_Action.ACTION_CONTINUE,
    ).length;
    this.logger.log(
      `Judge ${this.name} connected from ${this.identity.address ?? 'unknown'}: build ${loggableText(build)}, protocol 1.${Math.min(protocolMinor, PROTOCOL_MINOR)}, ${slots} slots, ${runtimes.length} runtimes, resumed ${resumed}, dropped ${plan.resume.length - resumed}`,
    );
    await judges.markSessionOnline(this.name, this.connectedAt, {
      slots,
      build,
      protocolMinor,
      features,
      runtimes,
      lastIp: this.identity.address,
    });
  }

  private onRunMessage(body: RunBody): Promise<unknown> {
    const { runs } = this.services;
    switch (body.$case) {
      case 'accepted':
        return this.handleRun(body.accepted, (key) => runs.accepted(key), true);
      case 'compiled': {
        const log = clipBytes(body.compiled.log, MAX_LOG_BYTES);
        return this.handleRun(body.compiled, (key) => runs.compiled(key, log));
      }
      case 'started': {
        const { pretested } = body.started;
        return this.handleRun(body.started, (key) =>
          runs.started(key, pretested),
        );
      }
      case 'cases': {
        const rows = caseRowsOf(body.cases.cases);
        return this.handleRun(body.cases, (key) => runs.cases(key, rows));
      }
      case 'final':
        return this.onFinal(body.final);
    }
  }

  /** The Final is acked only after its write and graded job; the slot is then free. A RETRY frees it with a ban on this judge for the row until the next resync tick. A winding run's Final writes nothing and frees its slot; a stale Final (the row moved on) ends the run too; a Final resent for a run that already ended is re-acked. */
  private async onFinal(final: Final): Promise<void> {
    const report = finalReportOf(final);
    const ref = refOf(final.ref);
    if (this.winding.has(windingKey(ref))) return this.windingFinal(ref);
    if (this.ended.has(windingKey(ref)))
      return this.replayedFinal(ref, seqOf(final.seq), report);
    const handled = await this.handleRun(final, (key) =>
      this.services.runs.final(key, report),
    );
    if (handled?.outcome === 'stale')
      return this.services.dispatch.windingEnded(this, handled.ref);
    if (handled?.outcome === 'applied' || handled?.outcome === 'duplicate') {
      remember(this.ended, windingKey(handled.ref));
      await this.services.dispatch.runEnded(this, handled.ref, {
        retried: report.kind === 'retry' && handled.outcome === 'applied',
      });
    }
  }

  /** The judge resent the Final of a run it already got an ack for (it may not have seen the ack): the write finds it stored, the ack goes out again; the slot was freed the first time. Anything else is treated as an unheld ref (`applied` cannot happen: the stored Final already advanced `judgeSeq` past this seq's filter). */
  private async replayedFinal(
    ref: AssignmentRef,
    seq: number,
    report: FinalReport,
  ): Promise<void> {
    const key = { ref, judgeName: this.name, seq };
    if ((await this.services.runs.final(key, report)) === 'duplicate')
      return this.send({ $case: 'ack', ack: { ref, seq } });
    this.abortOnce(ref);
  }

  /** judge-v2 ends every run it kills with `Final{ABORTED}`: not stored, not acked (plan A: the run is over for both sides), no Abort echo; the slot is freed. */
  private async windingFinal(ref: AssignmentRef): Promise<void> {
    await this.services.dispatch.windingEnded(this, ref);
  }

  /** Checks the ref, writes, acks; null when the ref is not this session's (ignored, answered with one Abort). */
  private async handleRun(
    message: { ref?: AssignmentRef; seq: number },
    write: (key: RunKey) => Promise<WriteOutcome>,
    isAccept = false,
  ): Promise<Handled | null> {
    const ref = refOf(message.ref);
    const seq = seqOf(message.seq);
    if (!this.holds(ref)) return this.onUnheld(ref, isAccept);
    if (seq === 1) this.clearAcceptTimer(ref);
    const outcome = await write({ ref, judgeName: this.name, seq });
    this.afterWrite(ref, seq, outcome);
    return { ref, outcome };
  }

  private afterWrite(
    ref: AssignmentRef,
    seq: number,
    outcome: WriteOutcome,
  ): void {
    switch (outcome) {
      case 'applied':
      case 'duplicate':
        return this.send({ $case: 'ack', ack: { ref, seq } });
      case 'stale':
        this.abortOnce(ref);
        this.services.dispatch.windDown(this, ref);
        return;
      case 'gap':
        throw seqGap(`seq ${seq} of ${ref.submissionId} skips one`);
      case 'full':
        throw new ProtocolError('more cases than a submission may have');
      case 'order':
        throw new ProtocolError(
          `seq ${seq} does not fit the state of ${ref.submissionId}`,
        );
    }
  }

  /** A message for a run this session does not hold: a winding run (already aborted: ignored, its Final is handled in `onFinal`), an earlier generation, another judge's, or an unknown id. A late Accepted for a run this session aborted (released at the accept timeout or voided by a rejudge) is ignored; Accepted for a ref it never aborted is a protocol error (decision 86). */
  private onUnheld(ref: AssignmentRef, isAccept: boolean): null {
    const key = windingKey(ref);
    if (this.winding.has(key)) return null;
    if (isAccept && !this.aborted.has(key))
      throw new ProtocolError(
        `Accepted for ${ref.submissionId}, which this session was not assigned`,
      );
    this.abortOnce(ref);
    return null;
  }

  private abortOnce(ref: AssignmentRef): void {
    if (!this.aborted.has(windingKey(ref))) this.abort(ref);
  }

  private onJudgeError(error: JudgeError): void {
    if (error.code === ErrorCode.ERROR_CODE_SLOTS_FULL)
      throw new ProtocolError(`the judge reports SLOTS_FULL: ${error.message}`);
    this.logger.warn(`${this.name} reports ${error.code}: ${error.message}`);
  }

  private ping(): void {
    const idleMs = this.services.timings.idleMs;
    if (!this.isHandling && Date.now() - this.lastReceivedAt > idleMs)
      return this.end(status.DEADLINE_EXCEEDED, 'silent for too long');
    this.nonce += 1;
    this.pingsSent.set(this.nonce, Date.now());
    this.pingsSent.delete(this.nonce - PING_SAMPLES);
    this.send({ $case: 'ping', ping: { nonce: this.nonce } });
  }

  /** Only an echo of a ping we sent is recorded: a judge cannot buy a Mongo write per message. */
  private async onPong(pong: Pong): Promise<void> {
    const sentAt = this.pingsSent.get(pong.nonce);
    if (sentAt === undefined) return;
    this.pingsSent.delete(pong.nonce);
    this.roundTrips.push((Date.now() - sentAt) / 1000);
    if (this.roundTrips.length > PING_SAMPLES) this.roundTrips.shift();
    const ping =
      this.roundTrips.reduce((total, value) => total + value, 0) /
      this.roundTrips.length;
    const load =
      Number.isFinite(pong.load) && pong.load >= 0 ? pong.load : null;
    await this.services.judges.recordPong(this.name, this.connectedAt, {
      ping,
      load,
      busy: Math.min(pong.busy, this.slots),
    });
  }

  private async acceptTimedOut(ref: AssignmentRef): Promise<void> {
    this.acceptTimers.delete(windingKey(ref));
    try {
      await this.services.dispatch.acceptTimedOut(this, ref);
    } catch (error) {
      this.logger.error(
        `${this.name}: releasing ${ref.submissionId} failed: ${(error as Error).message}`,
      );
    }
  }

  private clearAcceptTimer(ref: AssignmentRef): void {
    const key = windingKey(ref);
    clearTimeout(this.acceptTimers.get(key));
    this.acceptTimers.delete(key);
  }

  private async onClose(): Promise<void> {
    this.isClosed = true;
    clearTimeout(this.helloTimer);
    clearInterval(this.pingTimer);
    for (const timer of this.acceptTimers.values()) clearTimeout(timer);
    this.logger.log(
      `Judge ${this.name} disconnected${this.helloed ? '' : ' before Hello'}: ${this.closeReason ?? 'connection lost'}; ${this.inFlight.size} runs held`,
    );
    if (!this.helloed) return;
    const { dispatch, judges } = this.services;
    try {
      await dispatch.judgeLost(this);
      if (!dispatch.isStopped())
        await judges.markOffline(this.name, this.connectedAt);
    } catch (error) {
      this.logger.error(
        `${this.name}: cleanup failed: ${(error as Error).message}`,
      );
    }
  }
}
