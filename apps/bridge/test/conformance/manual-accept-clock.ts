import type { AssignmentRef } from '@libs/judge-proto';
import { windingKey } from '../../src/dispatch/slots';
import type { AcceptClock } from '../../src/link/accept-clock';

/** The bridge's accept clock in conformance: an armed window never times out on its own; the runner fires it when the transcript expects that run's Abort, so a host stall cannot decide the race. */
export class ManualAcceptClock implements AcceptClock {
  private readonly armed = new Map<string, () => void>();

  arm(ref: AssignmentRef, _ms: number, fire: () => void): () => void {
    const key = windingKey(ref);
    this.armed.set(key, fire);
    return () => {
      if (this.armed.get(key) === fire) this.armed.delete(key);
    };
  }

  /** Times out `ref`'s window if it is still armed (not accepted, aborted or ended); false otherwise. */
  fire(ref: AssignmentRef): boolean {
    const key = windingKey(ref);
    const fire = this.armed.get(key);
    if (!fire) return false;
    this.armed.delete(key);
    fire();
    return true;
  }
}
