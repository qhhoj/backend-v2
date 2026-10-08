import { Injectable } from '@nestjs/common';
import type { JudgeAccess } from '../judges/judges.repository';
import { GradingService } from '../submissions/grading.service';
import type { Claimed } from '../submissions/grading.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { insertQueued, nextFor, pickJudge } from './dispatch';
import type { DispatchTarget, QueuedSubmission } from './dispatch';

const isSameEntry = (left: QueuedSubmission, right: QueuedSubmission) =>
  left.priority === right.priority &&
  left.judgeName === right.judgeName &&
  left.bannedJudges.join() === right.bannedJudges.join();

/** The bridge's in-memory view (legacy `JudgeList`): connected judges by name and the queue in dispatch order. Mongo stays the truth: nothing is sent before `claim` moved it QU → P. */
@Injectable()
export class DispatchService {
  private readonly judges = new Map<string, DispatchTarget>();
  private readonly queue: QueuedSubmission[] = [];
  private readonly queued = new Map<string, QueuedSubmission>();
  private stopped = false;

  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly grading: GradingService,
  ) {}

  /** A second connection with the same name replaces the first, which is force-disconnected (legacy). */
  async register(judge: DispatchTarget): Promise<void> {
    const previous = this.judges.get(judge.name);
    this.judges.set(judge.name, judge);
    if (previous && previous !== judge) previous.disconnect({ isForced: true });
    await this.offerWork(judge);
  }

  /** Running ids are skipped and an unchanged queued entry stays put, so resyncs are idempotent; a queued entry that changed (a rejudge) is replaced. */
  async enqueue(submissions: QueuedSubmission[]): Promise<void> {
    for (const submission of submissions) {
      if (this.isRunning(submission.id)) continue;
      const queued = this.queued.get(submission.id);
      if (queued && isSameEntry(queued, submission)) continue;
      this.removeQueued(submission.id);
      const judge = this.stopped
        ? null
        : pickJudge(this.connected(), submission);
      if (judge) await this.dispatch(judge, submission);
      else {
        insertQueued(this.queue, submission);
        this.queued.set(submission.id, submission);
      }
    }
  }

  /** A free judge takes the first queued submission it may judge. */
  async offerWork(judge: DispatchTarget): Promise<void> {
    if (
      this.stopped ||
      judge.isClosed ||
      judge.workingOn !== null ||
      this.judges.get(judge.name) !== judge
    )
      return;
    const next = nextFor(judge, this.queue, this.connected());
    if (!next) return;
    this.removeQueued(next.id);
    await this.dispatch(judge, next);
  }

  /** The judge finished its submission (graded, compile error, internal error, aborted). */
  judgeFree(judge: DispatchTarget): Promise<void> {
    judge.workingOn = null;
    return this.offerWork(judge);
  }

  /** The connection closed: forget the judge unless it was already replaced, requeue its in-flight submission once (IE the second time), and let the others take what the reservation held back. While stopping nothing changes: the next start requeues P/G without spending the requeue. */
  async judgeLost(judge: DispatchTarget): Promise<void> {
    if (this.stopped) return;
    if (this.judges.get(judge.name) === judge) this.judges.delete(judge.name);
    const lost = judge.workingOn;
    judge.workingOn = null;
    if (
      lost !== null &&
      (await this.grading.disconnected(lost, judge.name)) === 'requeued'
    )
      await this.enqueue(await this.submissions.loadQueued([lost]));
    for (const other of this.connected()) await this.offerWork(other);
  }

  /** Running: the judge is told to terminate (it answers `submission-terminated`). Queued: dropped; the api already wrote AB. */
  abort(submissionId: string): void {
    // An abort during the claim window terminates before the request arrives (rare; the judge then grades it in full).
    const judge = [...this.judges.values()].find(
      (candidate) => candidate.workingOn === submissionId,
    );
    if (judge) judge.terminate();
    else this.removeQueued(submissionId);
  }

  async setDisabled(name: string, isDisabled: boolean): Promise<void> {
    const judge = this.judges.get(name);
    if (!judge) return;
    judge.isDisabled = isDisabled;
    await this.offerWork(judge);
  }

  hasQueued(submissionId: string): boolean {
    return this.queued.has(submissionId);
  }

  connectedNames(): string[] {
    return [...this.judges.keys()];
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
        judge.disconnect({ isForced: true });
      else if (stored.isDisabled !== judge.isDisabled)
        await this.setDisabled(name, stored.isDisabled);
    }
  }

  disconnect(name: string, { isForced }: { isForced: boolean }): void {
    this.judges.get(name)?.disconnect({ isForced });
  }

  /** Submissions a registered judge works on, a claim still in flight included (`workingOn` is set before the claim). A closing judge counts until its close is handled. */
  heldIds(): string[] {
    return [...this.judges.values()].flatMap((judge) =>
      judge.workingOn === null ? [] : [judge.workingOn],
    );
  }

  queuedIds(): string[] {
    return this.queue.map((submission) => submission.id);
  }

  /** Shutdown: no more dispatching; connections closing from now on leave their submissions P/G for the next start. */
  stop(): void {
    this.stopped = true;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /** Reserves the judge, claims in Mongo, then sends. A submission no longer QU is dropped and the judge looks again; if the judge vanished during the claim, the claim is given back. A claim that threw (released, null) stays out of the memory queue until the next resync. */
  private async dispatch(
    judge: DispatchTarget,
    submission: QueuedSubmission,
  ): Promise<void> {
    judge.workingOn = submission.id;
    let claimed: Claimed | null;
    try {
      claimed = await this.grading.claim(submission, judge.name);
    } catch (error) {
      judge.workingOn = null; // the claim failed and could not be released (Mongo down): the judge is free, the resync recovers the submission
      throw error;
    }
    if (judge.isClosed || this.judges.get(judge.name) !== judge) {
      judge.workingOn = null; // it never saw the submission, so a later close must not requeue it
      if (claimed && (await this.grading.release(submission.id, judge.name)))
        await this.enqueue([submission]);
      return;
    }
    if (!claimed) return this.judgeFree(judge);
    this.grading.sent(claimed.subject);
    judge.submit(claimed.request);
  }

  /** Registered judges whose socket is not closing. */
  private connected(): DispatchTarget[] {
    return [...this.judges.values()].filter((judge) => !judge.isClosed);
  }

  private isRunning(submissionId: string): boolean {
    return [...this.judges.values()].some(
      (judge) => judge.workingOn === submissionId,
    );
  }

  private removeQueued(submissionId: string): void {
    if (!this.queued.delete(submissionId)) return;
    const index = this.queue.findIndex(
      (submission) => submission.id === submissionId,
    );
    if (index !== -1) this.queue.splice(index, 1);
  }
}
