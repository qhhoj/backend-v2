import { Inject, Injectable, Logger } from '@nestjs/common';
import { BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import type { DispatchTarget } from '../dispatch/slots';
import { failureOf, generateOf, jobFailure } from './generation-messages';
import type { GenerationDone } from '@libs/judge-proto';
import { GenerationsRepository } from './generations.repository';

/** The in-memory generation queue and the life of a generation on a judge: claim (queued -> running), send, deadline, done or failed. Judge admission is the dispatcher's call (`mayStartGeneration`); Mongo stays the truth. */
@Injectable()
export class GenerationsService {
  private readonly logger = new Logger(GenerationsService.name);
  /** Queued generation ids, oldest first (a Set keeps insertion order and drops duplicates). */
  private readonly queue = new Set<string>();
  private readonly deadlines = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rows: GenerationsRepository,
    @Inject(BRIDGE_TIMINGS) private readonly timings: BridgeTimings,
  ) {}

  /** Queued rows named by `ids` (a command) or all of them (start, resync) that are not queued here yet. */
  async enqueueQueued(ids?: string[]): Promise<void> {
    for (const id of await this.rows.queuedIds(ids)) this.queue.add(id);
  }

  hasQueued(): boolean {
    return this.queue.size > 0;
  }

  isQueued(id: string): boolean {
    return this.queue.has(id);
  }

  /** Ids a live session holds, claims in flight included. */
  static heldIds(judges: Iterable<DispatchTarget>): Set<string> {
    return new Set([...judges].flatMap((judge) => [...judge.generations]));
  }

  /** Takes the oldest queued id: reserves the slot, claims the row, sends it. A row no longer queued frees the slot; a session that ended during the claim gives the row back. */
  async startFor(judge: DispatchTarget): Promise<void> {
    const [id] = this.queue;
    if (!id) return;
    this.queue.delete(id);
    judge.generations.add(id);
    try {
      await this.claimAndSend(judge, id);
    } catch (error) {
      judge.generations.delete(id);
      throw error;
    }
  }

  /** The judge's GenerationDone: the row is marked, then the slot is free. A message for a generation the session does not hold is ignored. */
  async done(judge: DispatchTarget, message: GenerationDone): Promise<void> {
    const id = message.generationId;
    if (!judge.generations.has(id)) return;
    this.clearDeadline(id);
    try {
      await this.record(judge, message);
    } finally {
      judge.generations.delete(id);
    }
  }

  /** The session ended: its generations fail, nothing is requeued (the job is bound to the session). */
  async judgeLost(judge: DispatchTarget): Promise<void> {
    for (const id of [...judge.generations]) {
      this.clearDeadline(id);
      await this.failQuietly(
        id,
        judge.id,
        jobFailure('INTERNAL', 'judge disconnected'),
      );
      judge.generations.delete(id);
    }
  }

  /** Resync: running rows no live session holds (the bridge restarted, a write was lost) can never finish and fail; rows past retention are removed. */
  async resync(held: ReadonlySet<string>): Promise<void> {
    await this.failStranded(held);
    await this.rows.deleteExpired();
  }

  /** A running row no live session holds (the bridge restarted, a write was lost) can never finish. */
  private async failStranded(held: ReadonlySet<string>): Promise<void> {
    for (const id of await this.rows.runningIds()) {
      if (held.has(id)) continue;
      const failure = jobFailure('INTERNAL', 'no judge holds the generation');
      if (await this.rows.failStranded(id, failure))
        this.logger.warn(
          `Generation ${id} was running on no live session; failed`,
        );
    }
  }

  stop(): void {
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
  }

  private async claimAndSend(judge: DispatchTarget, id: string): Promise<void> {
    const claimed = await this.rows.claim(id, judge.name, judge.id);
    if (!claimed) return void judge.generations.delete(id);
    if (judge.isClosed) {
      judge.generations.delete(id);
      await this.rows.release(id, judge.id);
      return void this.queue.add(id);
    }
    try {
      judge.generate(generateOf(claimed));
    } catch (error) {
      judge.generations.delete(id);
      return void (await this.failQuietly(
        id,
        judge.id,
        jobFailure('INTERNAL', `invalid plan: ${(error as Error).message}`),
      ));
    }
    this.armDeadline(judge, id, claimed.plan.deadlineS);
  }

  private async record(
    judge: DispatchTarget,
    message: GenerationDone,
  ): Promise<void> {
    const id = message.generationId;
    if (message.ok) {
      if (await this.rows.complete(id, judge.id)) return;
      return void (await this.rows.fail(
        id,
        judge.id,
        jobFailure(
          'INTERNAL',
          'the judge reported success without uploading the result',
        ),
      ));
    }
    await this.rows.fail(id, judge.id, failureOf(message.failure));
  }

  /** The judge keeps answering pings but never finishes: it is told to stop and the row fails; its slot stays taken until its GenerationDone or its disconnect. */
  private armDeadline(
    judge: DispatchTarget,
    id: string,
    deadlineS: number,
  ): void {
    const delay = deadlineS * 1000 + this.timings.generationGraceMs;
    const timer = setTimeout(() => void this.deadlineExpired(judge, id), delay);
    timer.unref();
    this.deadlines.set(id, timer);
  }

  private async deadlineExpired(
    judge: DispatchTarget,
    id: string,
  ): Promise<void> {
    this.deadlines.delete(id);
    if (!judge.generations.has(id)) return;
    this.logger.warn(
      `Judge ${judge.name} did not finish generation ${id} in time; cancelled`,
    );
    judge.cancelGeneration(id);
    await this.failQuietly(
      id,
      judge.id,
      jobFailure('JOB_TIME_LIMIT', 'the generation did not finish in time'),
    );
  }

  private clearDeadline(id: string): void {
    clearTimeout(this.deadlines.get(id));
    this.deadlines.delete(id);
  }

  /** For timers and cleanup: a Mongo failure is logged, the resync's stranded sweep recovers the row. */
  private async failQuietly(
    id: string,
    sessionId: string,
    failure: ReturnType<typeof jobFailure>,
  ): Promise<void> {
    try {
      await this.rows.fail(id, sessionId, failure);
    } catch (error) {
      this.logger.error(
        `Failing generation ${id} failed: ${(error as Error).message}`,
      );
    }
  }
}
