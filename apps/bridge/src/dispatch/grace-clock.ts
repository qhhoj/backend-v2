import type { AcceptClock } from '../link/accept-clock';
import { TIMER_ACCEPT_CLOCK } from '../link/accept-clock';

/** Times the resume grace of one lost judge's run: `fire` runs `ms` after `arm` unless the returned cancel runs first (the accept clock's shape). */
export type GraceClock = AcceptClock;

export const GRACE_CLOCK = Symbol('GRACE_CLOCK');

/** The production clock: one real timer per run in grace. The conformance runner swaps in a clock the scenario advances. */
export const TIMER_GRACE_CLOCK: GraceClock = TIMER_ACCEPT_CLOCK;
