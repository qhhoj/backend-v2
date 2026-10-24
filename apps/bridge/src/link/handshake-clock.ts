/** Whose handshake deadline: a socket's (until a session authenticates on it) or a judge session's (until its Hello). */
export type HandshakeOwner = { peer: string } | { judge: string };

/** Times the `handshakeMs` deadlines: `fire` runs `ms` after `arm` unless the returned cancel runs first. */
export interface HandshakeClock {
  arm(owner: HandshakeOwner, ms: number, fire: () => void): () => void;
}

export const HANDSHAKE_CLOCK = Symbol('HANDSHAKE_CLOCK');

/** The production clock: one real timer per deadline. The conformance runner swaps in a clock the scenario advances. */
export const TIMER_HANDSHAKE_CLOCK: HandshakeClock = {
  arm: (_owner, ms, fire) => {
    const timer = setTimeout(fire, ms);
    return () => clearTimeout(timer);
  },
};
