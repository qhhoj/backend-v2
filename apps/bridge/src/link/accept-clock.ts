import type { AssignmentRef } from '@libs/judge-proto';

/** Times the accept window of one Assign: `fire` runs `ms` after `arm` unless the returned cancel runs first. */
export interface AcceptClock {
  arm(ref: AssignmentRef, ms: number, fire: () => void): () => void;
}

export const ACCEPT_CLOCK = Symbol('ACCEPT_CLOCK');

/** The production clock: one real timer per Assign. The conformance runner swaps in a clock the scenario advances. */
export const TIMER_ACCEPT_CLOCK: AcceptClock = {
  arm: (_ref, ms, fire) => {
    const timer = setTimeout(fire, ms);
    return () => clearTimeout(timer);
  },
};
