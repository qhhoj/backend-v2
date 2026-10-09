import type { AssignmentRef } from '@libs/judge-proto';

/** A run whose judge went away; it waits `graceMs` for the judge to resume it. */
export interface GraceEntry {
  ref: AssignmentRef;
  judgeName: string;
  /** The api aborted it meanwhile: a resume sends Abort, an expiry writes AB. */
  abortRequested: boolean;
}

interface Held extends GraceEntry {
  timer: NodeJS.Timeout;
}

const entryOf = ({ ref, judgeName, abortRequested }: Held): GraceEntry => ({
  ref,
  judgeName,
  abortRequested,
});

/** Runs held in grace by submission id. Every way out (resume, rejudge, expiry, stop) removes the entry and its timer, so each entry ends exactly once. */
export class GraceRegistry {
  private readonly held = new Map<string, Held>();

  constructor(
    private readonly graceMs: number,
    private readonly onExpire: (entry: GraceEntry) => void,
  ) {}

  hold(ref: AssignmentRef, judgeName: string): void {
    this.remove(ref.submissionId);
    const timer = setTimeout(
      () => this.expireNow(ref.submissionId),
      this.graceMs,
    );
    this.held.set(ref.submissionId, {
      ref,
      judgeName,
      abortRequested: false,
      timer,
    });
  }

  /** The entry, removed, when `judgeName` holds exactly this generation; otherwise nothing changes. */
  take(ref: AssignmentRef, judgeName: string): GraceEntry | undefined {
    const entry = this.held.get(ref.submissionId);
    if (
      !entry ||
      entry.judgeName !== judgeName ||
      entry.ref.generation !== ref.generation
    )
      return undefined;
    this.remove(ref.submissionId);
    return entryOf(entry);
  }

  /** The row went back to QU (a rejudge): a held run of generation ≤ `generation` is void. */
  discard(submissionId: string, generation: number): void {
    const entry = this.held.get(submissionId);
    if (entry && entry.ref.generation <= generation) this.remove(submissionId);
  }

  /** False when nothing is held for it. */
  requestAbort(submissionId: string): boolean {
    const entry = this.held.get(submissionId);
    if (entry) entry.abortRequested = true;
    return entry !== undefined;
  }

  /** Ends the wait now (also used when a reconnected judge no longer lists the run). */
  expireNow(submissionId: string): void {
    const entry = this.held.get(submissionId);
    if (!entry) return;
    this.remove(submissionId);
    this.onExpire(entryOf(entry));
  }

  of(judgeName: string): GraceEntry[] {
    return [...this.held.values()]
      .filter((entry) => entry.judgeName === judgeName)
      .map(entryOf);
  }

  ids(): string[] {
    return [...this.held.keys()];
  }

  /** Shutdown: no timer fires after this; the rows stay P/G for the next start. */
  clear(): void {
    for (const id of [...this.held.keys()]) this.remove(id);
  }

  private remove(submissionId: string): void {
    const entry = this.held.get(submissionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.held.delete(submissionId);
  }
}
