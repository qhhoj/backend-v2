import type { AssignmentRef } from '@libs/judge-proto';
import type { GraceClock } from '../../src/dispatch/grace-clock';

interface Window {
  ref: AssignmentRef;
  due: number;
  fire: () => void;
}

/** The bridge's grace clock in conformance: virtual time that only the transcript's `wait` and `quiet` steps move, so a host stall cannot end a grace the transcript has not waited out, and a slow command cannot arrive after it. */
export class ManualGraceClock implements GraceClock {
  private now = 0;
  /** By submission id: one grace per run. */
  private readonly armed = new Map<string, Window>();

  arm(ref: AssignmentRef, ms: number, fire: () => void): () => void {
    const window: Window = { ref, due: this.now + ms, fire };
    this.armed.set(ref.submissionId, window);
    return () => {
      if (this.armed.get(ref.submissionId) === window)
        this.armed.delete(ref.submissionId);
    };
  }

  /** `ms` pass: every grace due by then expires, oldest first. */
  advance(ms: number): void {
    this.now += ms;
    const due = [...this.armed]
      .filter(([, window]) => window.due <= this.now)
      .sort(([, left], [, right]) => left.due - right.due);
    for (const [submissionId] of due) this.expire(submissionId);
  }

  /** Ends the grace of an earlier generation of `ref`'s submission, if one is armed: the transcript expects the run that follows it. */
  expireBefore(ref: AssignmentRef): void {
    const window = this.armed.get(ref.submissionId);
    if (window && window.ref.generation < ref.generation)
      this.expire(ref.submissionId);
  }

  private expire(submissionId: string): void {
    const window = this.armed.get(submissionId);
    if (!window) return;
    this.armed.delete(submissionId);
    window.fire();
  }
}
