import { Inject, Injectable, Logger } from '@nestjs/common';
import { unique } from '@libs/common';
import { Resume_Action } from '@libs/judge-proto';
import type { AssignmentRef, GenerationDone, Resume } from '@libs/judge-proto';
import {
  BRIDGE_TIMINGS,
  runDeadlineMs,
  startedRunDeadlineMs,
} from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import type { JudgeAccess } from '../judges/judges.repository';
import type { ResumeCandidate } from '../link/messages';
import { GenerationsService } from '../generations/generations.service';
import { RunsService } from '../submissions/runs.service';
import type { Claimed, GraceOutcome } from '../submissions/runs.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { GraceRegistry } from './grace';
import type { GraceEntry } from './grace';
import {
  freeSlots,
  insertQueued,
  mayStartGeneration,
  nextFor,
  pickJudge,
  windingKey,
} from './slots';
import type { DispatchTarget, QueuedSubmission } from './slots';

/** The Welcome's resume list, and the runs to abort right after it (an abort the api sent during the grace). */
export interface ResumePlan {
  resume: Resume[];
  abort: AssignmentRef[];
}

/** `<submissionId> gen <generation>`, for log lines. */
const runOf = (ref: AssignmentRef): string =>
  `${ref.submissionId} gen ${ref.generation}`;

const GRACE_OUTCOME_TEXT: Record<GraceOutcome, string> = {
  requeued: 'requeued',
  failed: 'internal error (second judge loss)',
  aborted: 'aborted (the user aborted it meanwhile)',
  stale: 'nothing to do (the row moved on)',
};

/** A resumed run's time limit is not known to the bridge; its deadline assumes this one (seconds). */
const RESUMED_RUN_TIME_LIMIT_SECONDS = 20;

const isSameEntry = (left: QueuedSubmission, right: QueuedSubmission) =>
  left.priority === right.priority &&
  left.judgeName === right.judgeName &&
  left.bannedJudges.join() === right.bannedJudges.join() &&
  left.retryBannedJudges.join() === right.retryBannedJudges.join();

/** A session between Hello and `register`: it holds the runs it resumed; `plan` is open until its Welcome goes out. */
interface Resuming {
  judge: DispatchTarget;
  plan: ResumePlan | null;
}

/** The bridge's in-memory view (legacy `JudgeList`): connected judges by name with the runs each holds, runs waiting in grace, and the queue in dispatch order. Mongo stays the truth: nothing is sent before the claim moved QU → P. */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);
  private readonly judges = new Map<string, DispatchTarget>();
  private readonly queue: QueuedSubmission[] = [];
  private readonly queued = new Map<string, QueuedSubmission>();
  /** Sessions still in their handshake, by judge name. */
  private readonly resuming = new Map<string, Resuming>();
  private readonly grace: GraceRegistry;
  /** `windingKey`s of held runs the api aborted, until they leave their session: a run that enters grace carries the abort even when its Abort reached a stream already dead. */
  private readonly abortsRequested = new Set<string>();
  private stopped = false;
  /** Per-run deadline timers by `windingKey`. */
  private readonly deadlines = new Map<string, NodeJS.Timeout>();
  /** Time limit (seconds) of each run with a deadline, by `windingKey`: its Started re-arms the deadline from it. */
  private readonly runTimeLimits = new Map<string, number>();

  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly runs: RunsService,
    private readonly generations: GenerationsService,
    @Inject(BRIDGE_TIMINGS) private readonly timings: BridgeTimings,
  ) {
    this.grace = new GraceRegistry(
      timings.resumeGraceMs,
      (entry) => void this.graceExpired(entry),
    );
  }

  /** Hello: an earlier session of the judge is replaced (its runs wait in grace), then each run the judge lists is resumed when Mongo still names this judge and generation (P/G), else dropped. Runs in grace it no longer lists expire now. */
  async resume(
    judge: DispatchTarget,
    listed: ResumeCandidate[],
  ): Promise<ResumePlan> {
    this.replace(judge);
    const plan: ResumePlan = { resume: [], abort: [] };
    const resuming: Resuming = { judge, plan };
    this.resuming.set(judge.name, resuming);
    for (const { ref } of listed) await this.resumeOne(judge, ref, plan);
    // replaced meanwhile: the newer handshake decides what expires
    if (judge.isClosed) return plan;
    const listedIds = new Set(listed.map(({ ref }) => ref.submissionId));
    for (const entry of this.grace.of(judge.name))
      if (!listedIds.has(entry.ref.submissionId))
        this.grace.expireNow(entry.ref.submissionId);
    // the session sends Welcome in this same turn: later aborts go to the judge directly
    resuming.plan = null;
    return plan;
  }

  /** The judge said Hello and got its Welcome: it takes work from now on. */
  async register(judge: DispatchTarget): Promise<void> {
    if (judge.isClosed) return;
    this.endHandshake(judge);
    this.replace(judge);
    this.judges.set(judge.name, judge);
    await this.offerWork(judge);
  }

  /** Running and claiming ids are skipped and an unchanged queued entry stays put, so resyncs are idempotent; a changed entry (a rejudge) replaces the old one, and a run still held for a rejudged row is void. */
  async enqueue(submissions: QueuedSubmission[]): Promise<void> {
    for (const submission of submissions) await this.enqueueOne(submission);
  }

  /** A judge with a free slot takes queued work until its slots are full or nothing fits. */
  async offerWork(judge: DispatchTarget): Promise<void> {
    while (this.takesWork(judge)) {
      const next = nextFor(judge, this.queue, this.connected());
      if (!next) break;
      this.removeQueued(next.id);
      await this.dispatch(judge, next);
    }
    await this.offerGenerations(judge);
  }

  /** Submissions come first: a generation starts only when none waits for this judge and it keeps a free slot (`mayStartGeneration`). */
  private async offerGenerations(judge: DispatchTarget): Promise<void> {
    while (
      this.takesWork(judge) &&
      this.generations.hasQueuedFor(judge) &&
      mayStartGeneration(
        judge,
        nextFor(judge, this.queue, this.connected()) !== null,
      )
    )
      await this.generations.startFor(judge);
  }

  /** Queued generation rows (all of them, or the ids a command named) join the queue and are offered to every judge. */
  async enqueueGenerations(ids?: string[]): Promise<void> {
    await this.generations.enqueueQueued(ids);
    for (const judge of this.connected()) await this.offerWork(judge);
  }

  /** Resync tick: queued generations no command announced are picked up, running ones no live session holds fail, and rows past their retention go with their files. */
  async resyncGenerations(): Promise<void> {
    await this.generations.resync(this.heldGenerationIds());
    await this.enqueueGenerations();
  }

  /** The judge's GenerationDone: the row is marked and the slot is free for the next work. */
  async generationDone(
    judge: DispatchTarget,
    message: GenerationDone,
  ): Promise<void> {
    await this.generations.done(judge, message);
    await this.offerWork(judge);
  }

  /** Generation ids a registered or handshaking session holds; the resync fails running rows outside this set. */
  heldGenerationIds(): Set<string> {
    return GenerationsService.heldIds(this.sessions());
  }

  /** The run ended (its Final was stored, or the row moved on): the slot is free. After a RETRY the judge may not take the row again until the next resync tick. */
  async runEnded(
    judge: DispatchTarget,
    ref: AssignmentRef,
    { retried }: { retried: boolean },
  ): Promise<void> {
    if (judge.inFlight.get(ref.submissionId) === ref.generation)
      judge.inFlight.delete(ref.submissionId);
    this.abortsRequested.delete(windingKey(ref));
    this.clearDeadline(ref);
    if (retried) {
      const rows = await this.submissions.loadQueued([ref.submissionId]);
      await this.enqueue(
        rows.map((row) => ({ ...row, retryBannedJudges: [judge.name] })),
      );
    }
    await this.offerWork(judge);
  }

  /** An Assign not accepted in time: that run alone is aborted and released (QU, no requeue spent) and goes to whoever is free; the judge's other slots are untouched. Its own slot stays taken until the judge's `Final{ABORTED}` for it (`winding`). */
  async acceptTimedOut(
    judge: DispatchTarget,
    ref: AssignmentRef,
  ): Promise<void> {
    // still tracked: the release publishes `queued`
    if (!this.keepSlotWinding(judge, ref)) return;
    this.logger.warn(
      `Judge ${judge.name} did not accept submission ${runOf(ref)} in time; aborted and requeued`,
    );
    judge.abort(ref);
    if (await this.runs.release(ref, judge.name))
      await this.enqueue(await this.submissions.loadQueued([ref.submissionId]));
    else this.runs.forget(ref);
    await this.offerWork(judge);
  }

  /** The bridge let go of a held run (accept timeout, rejudge void, stale write): judge-v2 frees a slot only when the run's process returns, so the run keeps its slot as `winding` until the judge's `Final` for it. False when the judge does not hold that generation. */
  windDown(judge: DispatchTarget, ref: AssignmentRef): boolean {
    if (!this.keepSlotWinding(judge, ref)) return false;
    this.runs.forget(ref);
    return true;
  }

  /** Moves a held run to `winding`; its events stay tracked. */
  private keepSlotWinding(judge: DispatchTarget, ref: AssignmentRef): boolean {
    if (judge.inFlight.get(ref.submissionId) !== ref.generation) return false;
    judge.inFlight.delete(ref.submissionId);
    this.abortsRequested.delete(windingKey(ref));
    this.clearDeadline(ref);
    judge.winding.add(windingKey(ref));
    return true;
  }

  /** Starts the run's deadline: a judge that keeps answering pings but never sends `Final` would hold the slot and the row for ever. */
  private armDeadline(
    judge: DispatchTarget,
    ref: AssignmentRef,
    timeLimitSeconds: number,
  ): void {
    this.runTimeLimits.set(windingKey(ref), timeLimitSeconds);
    this.startDeadline(
      judge,
      ref,
      runDeadlineMs(this.timings, timeLimitSeconds),
    );
  }

  /** The judge's applied Started names the case count: the run's deadline restarts from now with an allowance per case (never shorter than the Assign's), so a long legitimate run is not taken away. */
  runStarted(
    judge: DispatchTarget,
    ref: AssignmentRef,
    caseCount: number,
  ): void {
    const timeLimit = this.runTimeLimits.get(windingKey(ref));
    if (timeLimit === undefined) return;
    if (judge.inFlight.get(ref.submissionId) !== ref.generation) return;
    this.startDeadline(
      judge,
      ref,
      startedRunDeadlineMs(this.timings, timeLimit, caseCount),
    );
  }

  /** (Re)starts the run's deadline timer; `null` leaves the run without one. */
  private startDeadline(
    judge: DispatchTarget,
    ref: AssignmentRef,
    delay: number | null,
  ): void {
    if (delay === null) return;
    const key = windingKey(ref);
    clearTimeout(this.deadlines.get(key));
    const timer = setTimeout(
      () => void this.deadlineExpired(judge, ref),
      delay,
    );
    timer.unref();
    this.deadlines.set(key, timer);
  }

  private clearDeadline(ref: AssignmentRef): void {
    const key = windingKey(ref);
    clearTimeout(this.deadlines.get(key));
    this.deadlines.delete(key);
    this.runTimeLimits.delete(key);
  }

  /** The judge still holds the run: its slot winds down (freed by the judge's `Final{ABORTED}`), the judge is told to stop, and the run is requeued once, internal error the second time (same as a lost judge); a run the user aborted ends AB. */
  private async deadlineExpired(
    judge: DispatchTarget,
    ref: AssignmentRef,
  ): Promise<void> {
    // read before `windDown` forgets it
    const abortRequested = this.abortsRequested.has(windingKey(ref));
    this.clearDeadline(ref);
    if (!this.windDown(judge, ref)) return;
    this.logger.warn(
      `Judge ${judge.name} did not finish submission ${runOf(ref)} before its deadline; aborted`,
    );
    judge.abort(ref);
    await this.graceExpired({
      ref,
      judgeName: judge.name,
      abortRequested,
    });
  }

  /** The judge's `Final` for a winding run: nothing is written, the slot is free. */
  async windingEnded(judge: DispatchTarget, ref: AssignmentRef): Promise<void> {
    if (judge.winding.delete(windingKey(ref))) await this.offerWork(judge);
  }

  /** The session ended: forget it unless already replaced; its runs wait in grace (requeue once / IE when it expires). While stopping nothing changes: the rows stay P/G for a resume or the next start's resync. */
  async judgeLost(judge: DispatchTarget): Promise<void> {
    if (this.stopped) return;
    if (this.judges.get(judge.name) === judge) this.judges.delete(judge.name);
    this.endHandshake(judge);
    this.holdInGrace(judge);
    await this.generations.judgeLost(judge);
    for (const other of this.connected()) await this.offerWork(other);
  }

  /** A running run is told to stop (the judge answers Final ABORTED); one in grace is aborted when it resumes or expires; a queued one is dropped (the api already wrote AB). The abort sticks when the judge turns out to be gone (`abortsRequested`). Best-effort: a run still being claimed is not reached, the user aborts again. */
  abort(submissionId: string): void {
    for (const judge of this.judges.values()) {
      const generation = judge.inFlight.get(submissionId);
      if (!generation) continue;
      const ref = { submissionId, generation };
      this.abortsRequested.add(windingKey(ref));
      return judge.abort(ref);
    }
    if (this.abortResumed(submissionId)) return;
    if (this.grace.requestAbort(submissionId)) return;
    this.removeQueued(submissionId);
  }

  async setDisabled(name: string, isDisabled: boolean): Promise<void> {
    const judge = this.judges.get(name);
    if (!judge) return;
    judge.isDisabled = isDisabled;
    await this.offerWork(judge);
  }

  /** Mongo is the truth for access: a connected judge that is now blocked, deleted or holds a rotated key is dropped, and a changed `isDisabled` is applied. Covers a lost command. Returns the names dropped, for the link to revoke. */
  async reconcile(access: JudgeAccess[]): Promise<string[]> {
    const byName = new Map(access.map((judge) => [judge.name, judge]));
    const dropped: string[] = [];
    for (const [name, judge] of this.judges) {
      const stored = byName.get(name);
      if (
        !stored ||
        stored.isBlocked ||
        stored.authKeyHash !== judge.authKeyHash
      ) {
        judge.disconnect({
          isForced: true,
          reason: 'blocked, deleted or key rotated',
        });
        dropped.push(name);
      } else if (stored.isDisabled !== judge.isDisabled)
        await this.setDisabled(name, stored.isDisabled);
    }
    return dropped;
  }

  disconnect(name: string, { isForced }: { isForced: boolean }): void {
    this.judges
      .get(name)
      ?.disconnect({ isForced, reason: 'disconnected by an admin' });
  }

  /** Resync tick: judges that answered RETRY may take those rows again. */
  async clearRetryBans(): Promise<void> {
    for (const [index, entry] of this.queue.entries())
      if (entry.retryBannedJudges.length) {
        const cleared = { ...entry, retryBannedJudges: [] };
        this.queue[index] = cleared;
        this.queued.set(entry.id, cleared);
      }
    for (const judge of this.connected()) await this.offerWork(judge);
  }

  /** The registered session of a judge, for FetchSource. */
  sessionOf(name: string): DispatchTarget | undefined {
    return this.judges.get(name);
  }

  hasQueued(submissionId: string): boolean {
    return this.queued.has(submissionId);
  }

  connectedNames(): string[] {
    return [...this.judges.keys()];
  }

  /** Runs a registered or handshaking judge holds (a claim in flight included) and runs waiting in grace: the resync never requeues these. */
  heldIds(): string[] {
    const live = this.sessions().flatMap((judge) => [...judge.inFlight.keys()]);
    return [...live, ...this.grace.ids()];
  }

  queuedIds(): string[] {
    return this.queue.map((submission) => submission.id);
  }

  /** Shutdown: no more dispatching, no grace timer fires; sessions ending from now on leave their rows P/G. */
  stop(): void {
    this.stopped = true;
    this.grace.clear();
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
    this.runTimeLimits.clear();
    this.generations.stop();
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /** A row read before a claim that went through (a resync racing a dispatch) is stale: the session keeps its run, nothing is re-dispatched. */
  private async enqueueOne(submission: QueuedSubmission): Promise<void> {
    this.voidOlderRuns(submission);
    if (this.isHeld(submission.id)) return;
    const queued = this.queued.get(submission.id);
    if (queued && isSameEntry(queued, submission)) return;
    this.removeQueued(submission.id);
    const judge = this.stopped ? null : pickJudge(this.connected(), submission);
    if (judge) return this.dispatch(judge, submission);
    insertQueued(this.queue, submission);
    this.queued.set(submission.id, submission);
  }

  /** The row is QU at `generation`, so a run of that generation or older still held (live, resumed by a handshaking session, or in grace) is void: the judge is told to stop, and the slot comes back with its `Final{ABORTED}` (`winding`). A newer run (claimed after the row was read) or a claim in flight is kept. */
  private voidOlderRuns(submission: QueuedSubmission): void {
    this.grace.discard(submission.id, submission.generation);
    for (const judge of this.sessions()) {
      const generation = judge.inFlight.get(submission.id);
      if (!generation || generation > submission.generation) continue;
      const ref = { submissionId: submission.id, generation };
      this.windDown(judge, ref);
      this.sendAbort(judge, ref);
    }
  }

  /** Some session holds a run of it, or is claiming it. */
  private isHeld(submissionId: string): boolean {
    return this.sessions().some((judge) => judge.inFlight.has(submissionId));
  }

  private async resumeOne(
    judge: DispatchTarget,
    ref: AssignmentRef,
    plan: ResumePlan,
  ): Promise<void> {
    const stored = await this.runs.resumableSeq(ref, judge.name);
    // taken only now: while Mongo is read the entry stays in grace, where an abort or a failed read leaves it
    if (judge.isClosed) return;
    const waiting = this.grace.take(ref, judge.name);
    if (waiting)
      this.logger.log(
        `Grace of submission ${runOf(ref)} on judge ${judge.name}: ${stored === null ? 'dropped on resume (the row moved on)' : 'resumed'}`,
      );
    if (stored === null) {
      // judge-v2 ends a dropped run with Final{ABORTED}; until then it holds a slot
      judge.winding.add(windingKey(ref));
      this.runs.forget(ref);
      plan.resume.push({ ref, action: Resume_Action.ACTION_DROP, fromSeq: 0 });
      return;
    }
    judge.inFlight.set(ref.submissionId, ref.generation);
    this.armDeadline(judge, ref, RESUMED_RUN_TIME_LIMIT_SECONDS);
    plan.resume.push({
      ref,
      action: Resume_Action.ACTION_CONTINUE,
      fromSeq: stored + 1,
    });
    if (!waiting?.abortRequested) return;
    this.abortsRequested.add(windingKey(ref));
    plan.abort.push(ref);
  }

  /** A newer session of the same judge takes over (the registered one, or one still in its handshake): the old one's runs wait in grace for it to resume them. */
  private replace(judge: DispatchTarget): void {
    const earlier = [
      this.judges.get(judge.name),
      this.resuming.get(judge.name)?.judge,
    ];
    for (const previous of new Set(earlier)) {
      if (!previous || previous === judge) continue;
      if (this.judges.get(judge.name) === previous)
        this.judges.delete(judge.name);
      this.endHandshake(previous);
      this.holdInGrace(previous);
      previous.replaced();
    }
  }

  private endHandshake(judge: DispatchTarget): void {
    if (this.resuming.get(judge.name)?.judge === judge)
      this.resuming.delete(judge.name);
  }

  /** An abort for a run a handshaking session resumed: into its Welcome's abort list while that is open, else straight to the judge. */
  private abortResumed(submissionId: string): boolean {
    for (const { judge } of this.resuming.values()) {
      const generation = judge.inFlight.get(submissionId);
      if (!generation) continue;
      const ref = { submissionId, generation };
      this.abortsRequested.add(windingKey(ref));
      this.sendAbort(judge, ref);
      return true;
    }
    return false;
  }

  /** An Abort for a session still building its Welcome joins the Welcome's abort list (nothing may precede the Welcome); otherwise it goes out now. */
  private sendAbort(judge: DispatchTarget, ref: AssignmentRef): void {
    const plan = this.resuming.get(judge.name)?.plan;
    if (this.resuming.get(judge.name)?.judge !== judge || !plan)
      return judge.abort(ref);
    const listed = plan.abort.some(
      (entry) =>
        entry.submissionId === ref.submissionId &&
        entry.generation === ref.generation,
    );
    if (!listed) plan.abort.push(ref);
  }

  /** Held runs wait in grace, carrying an api abort, unless a newer session of the judge already resumed them; winding runs are over for the bridge, and the session that counted them is gone. */
  private holdInGrace(judge: DispatchTarget): void {
    const held: string[] = [];
    for (const [submissionId, generation] of judge.inFlight) {
      const ref = { submissionId, generation };
      // a run another live session holds keeps its mark: that holder owns the abort (it ends with `runEnded` or `keepSlotWinding`)
      if (generation > 0 && !this.heldElsewhere(judge, submissionId)) {
        this.grace.hold(
          ref,
          judge.name,
          this.abortsRequested.delete(windingKey(ref)),
        );
        held.push(runOf(ref));
        this.clearDeadline(ref);
      }
    }
    if (held.length)
      this.logger.warn(
        `Judge ${judge.name} lost; submissions in grace: ${held.join(', ')}`,
      );
    judge.inFlight.clear();
    judge.winding.clear();
  }

  private heldElsewhere(except: DispatchTarget, submissionId: string): boolean {
    return this.sessions().some(
      (judge) =>
        judge !== except && !judge.isClosed && judge.inFlight.has(submissionId),
    );
  }

  /** Registered sessions and sessions in their handshake. */
  private sessions(): DispatchTarget[] {
    return unique([
      ...this.judges.values(),
      ...[...this.resuming.values()].map(({ judge }) => judge),
    ]);
  }

  /** A failed write (Mongo) holds the run in grace again, so the retry still spends the requeue; the resync's stranded-run reset would not. A failed enqueue after a requeue is left to the resync (the row is QU). */
  private async graceExpired(entry: GraceEntry): Promise<void> {
    const { ref, judgeName } = entry;
    let outcome: GraceOutcome;
    try {
      outcome = await this.runs.graceExpired(
        ref,
        judgeName,
        entry.abortRequested,
      );
    } catch (error) {
      this.logger.error(
        `Grace expiry of submission ${runOf(ref)} on judge ${judgeName} failed, held again: ${(error as Error).message}`,
      );
      return this.holdAgain(entry);
    }
    this.logger.warn(
      `Grace of submission ${runOf(ref)} on judge ${judgeName} expired: ${GRACE_OUTCOME_TEXT[outcome]}`,
    );
    if (outcome === 'requeued') await this.dispatchRequeued(ref.submissionId);
  }

  /** The row is QU: a failed read or enqueue is left to the resync. Runs from a timer, so nothing may reject (an unhandled rejection kills the process). */
  private async dispatchRequeued(submissionId: string): Promise<void> {
    try {
      await this.enqueue(await this.submissions.loadQueued([submissionId]));
    } catch (error) {
      this.logger.error(
        `Dispatching requeued submission ${submissionId} failed, the resync recovers it: ${(error as Error).message}`,
      );
    }
  }

  private holdAgain({ ref, judgeName, abortRequested }: GraceEntry): void {
    const id = ref.submissionId;
    if (!this.stopped && !this.isHeld(id) && !this.grace.ids().includes(id))
      this.grace.hold(ref, judgeName, abortRequested);
  }

  private takesWork(judge: DispatchTarget): boolean {
    return (
      !this.stopped &&
      !judge.isClosed &&
      this.judges.get(judge.name) === judge &&
      freeSlots(judge) > 0
    );
  }

  /** Reserves a slot, claims in Mongo, then sends. A row no longer QU frees the slot; if the session ended during the claim, the claim is given back. */
  private async dispatch(
    judge: DispatchTarget,
    submission: QueuedSubmission,
  ): Promise<void> {
    // never over a run some session holds: its live ref would be lost
    if (this.isHeld(submission.id)) return;
    judge.inFlight.set(submission.id, 0);
    let claimed: Claimed | null;
    try {
      claimed = await this.runs.claim(submission, judge.name);
    } catch (error) {
      judge.inFlight.delete(submission.id);
      throw error;
    }
    if (judge.isClosed || this.judges.get(judge.name) !== judge)
      return this.giveBack(judge, submission, claimed);
    if (!claimed) return void judge.inFlight.delete(submission.id);
    judge.inFlight.set(submission.id, claimed.request.ref.generation);
    this.runs.sent(claimed);
    judge.assign(claimed.request);
    this.armDeadline(judge, claimed.request.ref, claimed.request.timeLimit);
  }

  /** The session ended while its claim was in flight: it never saw the run, so the claim goes back without spending the requeue. */
  private async giveBack(
    judge: DispatchTarget,
    submission: QueuedSubmission,
    claimed: Claimed | null,
  ): Promise<void> {
    judge.inFlight.delete(submission.id);
    if (claimed && (await this.runs.release(claimed.request.ref, judge.name)))
      await this.enqueue([
        { ...submission, generation: claimed.request.ref.generation },
      ]);
  }

  /** Registered sessions that are not ending. */
  private connected(): DispatchTarget[] {
    return [...this.judges.values()].filter((judge) => !judge.isClosed);
  }

  private removeQueued(submissionId: string): void {
    if (!this.queued.delete(submissionId)) return;
    const index = this.queue.findIndex(
      (submission) => submission.id === submissionId,
    );
    if (index !== -1) this.queue.splice(index, 1);
  }
}
