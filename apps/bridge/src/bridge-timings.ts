export interface BridgeTimings {
  /** Absolute deadlines from the connection: a socket with no authenticated session, and a session without Hello, are closed after this; trickling bytes does not extend it. */
  handshakeMs: number;
  /** After Hello: silence from the judge this long closes the session (the clock pauses while a message is handled). */
  idleMs: number;
  pingIntervalMs: number;
  /** Queued submissions in Mongo that no command announced are picked up at this interval. */
  resyncMs: number;
  /** An Assign not accepted within this is released and goes to another slot. */
  acceptMs: number;
  /** A lost judge's runs wait this long for it to reconnect and resume them before they are requeued. */
  resumeGraceMs: number;
  /** A run still held this long after Assign, whatever pings say, is taken from its judge and requeued (IE the second time): `runMarginMs` + the problem's time limit × `runCaseBudget` (the bridge does not know the case count, so this is a generous per-case allowance). */
  runMarginMs: number;
  runCaseBudget: number;
  /** A queued submission pinned to a judge that has not been connected this long after it was submitted falls back to any judge. */
  pinFallbackMs: number;
  /** A test generation still held this long after its own `deadline_s` is cancelled and fails with JOB_TIME_LIMIT. */
  generationGraceMs: number;
}

export const BRIDGE_TIMINGS = Symbol('BRIDGE_TIMINGS');

/** Spec §3.8: Hello 15 s, idle 60 s, a ping every 10 s, Accepted 20 s, resync 30 s, resume grace 30 s. */
export const DEFAULT_BRIDGE_TIMINGS: BridgeTimings = {
  handshakeMs: 15_000,
  idleMs: 60_000,
  pingIntervalMs: 10_000,
  resyncMs: 30_000,
  acceptMs: 20_000,
  resumeGraceMs: 30_000,
  runMarginMs: 10 * 60_000,
  runCaseBudget: 100,
  pinFallbackMs: 5 * 60_000,
  generationGraceMs: 60_000,
};

/** Deadline of one run from its Assign; `null` (no deadline) when the inputs are not finite. */
export function runDeadlineMs(
  timings: Pick<BridgeTimings, 'runMarginMs' | 'runCaseBudget'>,
  timeLimitSeconds: number,
): number | null {
  const deadline =
    timings.runMarginMs + timeLimitSeconds * 1000 * timings.runCaseBudget;
  return Number.isFinite(deadline) && deadline > 0 ? deadline : null;
}
