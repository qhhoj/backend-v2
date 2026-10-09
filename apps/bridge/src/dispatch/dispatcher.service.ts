import { Inject, Injectable, Logger } from '@nestjs/common';
import { unique } from '@libs/common';
import { Resume_Action } from '@libs/judge-proto';
import type { AssignmentRef, Resume } from '@libs/judge-proto';
import { BRIDGE_TIMINGS } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';
import type { JudgeAccess } from '../judges/judges.repository';
import type { ResumeCandidate } from '../link/messages';
import { RunsService } from '../submissions/runs.service';
import type { Claimed } from '../submissions/runs.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { GraceRegistry } from './grace';
import type { GraceEntry } from './grace';
import {
  freeSlots,
  insertQueued,
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
  private stopped = false;

  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly runs: RunsService,
    @Inject(BRIDGE_TIMINGS) timings: BridgeTimings,
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
      if (!next) return;
      this.removeQueued(next.id);
      await this.dispatch(judge, next);
    }
  }

  /** The run ended (its Final was stored, or the row moved on): the slot is free. After a RETRY the judge may not take the row again until the next resync tick. */
  async runEnded(
    judge: DispatchTarget,
    ref: AssignmentRef,
    { retried }: { retried: boolean },
  ): Promise<void> {
    if (judge.inFlight.get(ref.submissionId) === ref.generation)
      judge.inFlight.delete(ref.submissionId);
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
    if (!this.windDown(judge, ref)) return;
    judge.abort(ref);
    if (await this.runs.release(ref, judge.name))
      await this.enqueue(await this.submissions.loadQueued([ref.submissionId]));
    await this.offerWork(judge);
  }

  /** The bridge let go of a held run (accept timeout, rejudge void, stale write): judge-v2 frees a slot only when the run's process returns, so the run keeps its slot as `winding` until the judge's `Final` for it. False when the judge does not hold that generation. */
  windDown(judge: DispatchTarget, ref: AssignmentRef): boolean {
    if (judge.inFlight.get(ref.submissionId) !== ref.generation) return false;
    judge.inFlight.delete(ref.submissionId);
    judge.winding.add(windingKey(ref));
    return true;
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
    for (const other of this.connected()) await this.offerWork(other);
  }

  /** A running run is told to stop (the judge answers Final ABORTED); one in grace is aborted when it resumes or expires; a queued one is dropped (the api already wrote AB). Best-effort: a run still being claimed is not reached, the user aborts again. */
  abort(submissionId: string): void {
    for (const judge of this.judges.values()) {
      const generation = judge.inFlight.get(submissionId);
      if (generation) return judge.abort({ submissionId, generation });
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

  /** Mongo is the truth for access: a connected judge that is now blocked, deleted or holds a rotated key is dropped, and a changed `isDisabled` is applied. Covers a lost command. */
  async reconcile(access: JudgeAccess[]): Promise<void> {
    const byName = new Map(access.map((judge) => [judge.name, judge]));
    for (const [name, judge] of this.judges) {
      const stored = byName.get(name);
      if (
        !stored ||
        stored.isBlocked ||
        stored.authKeyHash !== judge.authKeyHash
      )
        judge.disconnect({
          isForced: true,
          reason: 'blocked, deleted or key rotated',
        });
      else if (stored.isDisabled !== judge.isDisabled)
        await this.setDisabled(name, stored.isDisabled);
    }
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
  }

  isStopped(): boolean {
    return this.stopped;
  }

  private async enqueueOne(submission: QueuedSubmission): Promise<void> {
    if (this.isClaiming(submission.id)) return;
    this.voidOlderRuns(submission);
    const queued = this.queued.get(submission.id);
    if (queued && isSameEntry(queued, submission)) return;
    this.removeQueued(submission.id);
    const judge = this.stopped ? null : pickJudge(this.connected(), submission);
    if (judge) return this.dispatch(judge, submission);
    insertQueued(this.queue, submission);
    this.queued.set(submission.id, submission);
  }

  /** The row is QU at `generation`, so a run of that generation or older still held (live or in grace) is void: a live judge is told to stop, and the slot comes back with its `Final{ABORTED}` (`winding`). A newer run (claimed after the row was read) is kept. */
  private voidOlderRuns(submission: QueuedSubmission): void {
    this.grace.discard(submission.id, submission.generation);
    for (const judge of this.judges.values()) {
      const generation = judge.inFlight.get(submission.id);
      if (!generation || generation > submission.generation) continue;
      const ref = { submissionId: submission.id, generation };
      this.windDown(judge, ref);
      judge.abort(ref);
    }
  }

  private isClaiming(submissionId: string): boolean {
    return [...this.judges.values()].some(
      (judge) => judge.inFlight.get(submissionId) === 0,
    );
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
    if (stored === null) {
      // judge-v2 ends a dropped run with Final{ABORTED}; until then it holds a slot
      judge.winding.add(windingKey(ref));
      plan.resume.push({ ref, action: Resume_Action.ACTION_DROP, fromSeq: 0 });
      return;
    }
    judge.inFlight.set(ref.submissionId, ref.generation);
    plan.resume.push({
      ref,
      action: Resume_Action.ACTION_CONTINUE,
      fromSeq: stored + 1,
    });
    if (waiting?.abortRequested) plan.abort.push(ref);
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
    for (const { judge, plan } of this.resuming.values()) {
      const generation = judge.inFlight.get(submissionId);
      if (!generation) continue;
      const ref = { submissionId, generation };
      if (!plan) judge.abort(ref);
      else if (
        !plan.abort.some((listed) => listed.submissionId === submissionId)
      )
        plan.abort.push(ref);
      return true;
    }
    return false;
  }

  /** Held runs wait in grace, unless a newer session of the judge already resumed them; winding runs are over for the bridge, and the session that counted them is gone. */
  private holdInGrace(judge: DispatchTarget): void {
    for (const [submissionId, generation] of judge.inFlight)
      if (generation > 0 && !this.heldElsewhere(judge, submissionId))
        this.grace.hold({ submissionId, generation }, judge.name);
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

  private async graceExpired(entry: GraceEntry): Promise<void> {
    try {
      const outcome = await this.runs.graceExpired(
        entry.ref,
        entry.judgeName,
        entry.abortRequested,
      );
      if (outcome === 'requeued')
        await this.enqueue(
          await this.submissions.loadQueued([entry.ref.submissionId]),
        );
    } catch (error) {
      this.logger.error(
        `Grace expiry of ${entry.ref.submissionId} failed, the resync recovers it: ${(error as Error).message}`,
      );
    }
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
    this.runs.sent(claimed.subject);
    judge.assign(claimed.request);
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
