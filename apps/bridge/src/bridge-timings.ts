export interface BridgeTimings {
  /** Absolute deadline for the handshake, counted from the connection; trickling bytes does not extend it. */
  handshakeMs: number;
  /** After the handshake: silence from the judge this long closes the connection. */
  idleMs: number;
  /** A `submission-request` not acknowledged within this closes the connection. */
  ackMs: number;
  pingIntervalMs: number;
  /** An Assign not accepted within this is released and goes to another slot. */
  acceptMs: number;
  /** A lost judge's runs wait this long for it to reconnect and resume them before they are requeued. */
  resumeGraceMs: number;
  /** Queued submissions in Mongo that no command announced are picked up at this interval. */
  resyncMs: number;
}

export const BRIDGE_TIMINGS = Symbol('BRIDGE_TIMINGS');

/** Legacy bridge: 15 s to authenticate, 60 s socket timeout after it, 20 s to acknowledge, a ping every 10 s. */
export const DEFAULT_BRIDGE_TIMINGS: BridgeTimings = {
  handshakeMs: 15_000,
  idleMs: 60_000,
  ackMs: 20_000,
  pingIntervalMs: 10_000,
  resyncMs: 30_000,
  acceptMs: 20_000,
  resumeGraceMs: 30_000,
};
