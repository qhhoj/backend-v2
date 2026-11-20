import { insertQueued } from './slots';
import type { QueuedSubmission } from './slots';

const isSameEntry = (left: QueuedSubmission, right: QueuedSubmission) =>
  left.priority === right.priority &&
  left.judgeName === right.judgeName &&
  left.bannedJudges.join() === right.bannedJudges.join() &&
  left.retryBannedJudges.join() === right.retryBannedJudges.join() &&
  left.requiredFeatures.join() === right.requiredFeatures.join() &&
  JSON.stringify(left.refusedBy) === JSON.stringify(right.refusedBy) &&
  left.retryAfter === right.retryAfter &&
  left.waitsForData === right.waitsForData &&
  left.dataVersion === right.dataVersion;

/** The dispatcher's queue in dispatch order (`insertQueued`), with an index by submission id. Plain data: no I/O, no timers. */
export class DispatchQueue {
  private readonly entries: QueuedSubmission[] = [];
  private readonly byId = new Map<string, QueuedSubmission>();

  /** The entries in dispatch order, for `nextFor`; the same array the queue changes. */
  ordered(): readonly QueuedSubmission[] {
    return this.entries;
  }

  get(submissionId: string): QueuedSubmission | undefined {
    return this.byId.get(submissionId);
  }

  has(submissionId: string): boolean {
    return this.byId.has(submissionId);
  }

  ids(): string[] {
    return this.entries.map((submission) => submission.id);
  }

  /** Whether the queue holds this submission with the same constraints (an idempotent resync leaves it in place). */
  holdsSame(submission: QueuedSubmission): boolean {
    const queued = this.byId.get(submission.id);
    return queued !== undefined && isSameEntry(queued, submission);
  }

  insert(submission: QueuedSubmission): void {
    insertQueued(this.entries, submission);
    this.byId.set(submission.id, submission);
  }

  /** Swaps a queued entry for a copy with other constraints, keeping its place in the queue. */
  replace(entry: QueuedSubmission): void {
    const index = this.entries.findIndex(({ id }) => id === entry.id);
    this.entries[index] = entry;
    this.byId.set(entry.id, entry);
  }

  remove(submissionId: string): void {
    if (!this.byId.delete(submissionId)) return;
    const index = this.entries.findIndex(
      (submission) => submission.id === submissionId,
    );
    if (index !== -1) this.entries.splice(index, 1);
  }
}
