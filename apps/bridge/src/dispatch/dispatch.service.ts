import { Injectable } from '@nestjs/common';
import type { SubmissionRequest } from '../protocol/judge-packets';
import { GradingService } from '../submissions/grading.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { insertQueued, nextFor, pickJudge } from './dispatch';
import type { DispatchTarget, QueuedSubmission } from './dispatch';

/** The bridge's in-memory view (legacy `JudgeList`): connected judges by name and the queue in dispatch order. Mongo stays the truth: nothing is sent before `claim` moved it QU → P. */
@Injectable()
export class DispatchService {
  private readonly judges = new Map<string, DispatchTarget>();
  private readonly queue: QueuedSubmission[] = [];
  private readonly queued = new Set<string>();
  private stopped = false;

  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly grading: GradingService,
  ) {}

  /** A second connection with the same name replaces the first, which is force-disconnected (legacy). */
  async register(judge: DispatchTarget): Promise<void> {
    const previous = this.judges.get(judge.name);
    this.judges.set(judge.name, judge);
    if (previous && previous !== judge) previous.disconnect(true);
    await this.offerWork(judge);
  }

  /** Queued or running ids are skipped, so rejudges and resyncs are idempotent. */
  async enqueue(submissions: QueuedSubmission[]): Promise<void> {
    for (const submission of submissions) {
      if (this.isKnown(submission.id)) continue;
      const judge = this.stopped
        ? null
        : pickJudge(this.connected(), submission);
      if (judge) await this.dispatch(judge, submission);
      else {
        insertQueued(this.queue, submission);
        this.queued.add(submission.id);
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

  disconnect(name: string, force: boolean): void {
    this.judges.get(name)?.disconnect(force);
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
    let request: SubmissionRequest | null;
    try {
      request = await this.grading.claim(submission, judge.name);
    } catch (error) {
      judge.workingOn = null; // the claim failed and could not be released (Mongo down): the judge is free, the resync recovers the submission
      throw error;
    }
    if (judge.isClosed || this.judges.get(judge.name) !== judge) {
      judge.workingOn = null; // it never saw the submission, so a later close must not requeue it
      if (
        request &&
        (await this.submissions.release(submission.id, judge.name))
      )
        await this.enqueue([submission]);
      return;
    }
    if (!request) return this.judgeFree(judge);
    judge.submit(request);
  }

  /** Registered judges whose socket is not closing. */
  private connected(): DispatchTarget[] {
    return [...this.judges.values()].filter((judge) => !judge.isClosed);
  }

  private isKnown(submissionId: string): boolean {
    return (
      this.queued.has(submissionId) ||
      [...this.judges.values()].some(
        (judge) => judge.workingOn === submissionId,
      )
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
