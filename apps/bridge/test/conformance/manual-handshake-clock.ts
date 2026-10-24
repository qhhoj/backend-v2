import type {
  HandshakeClock,
  HandshakeOwner,
} from '../../src/link/handshake-clock';

/** The bridge's handshake clock in conformance: no deadline ends on its own. A session's Hello deadline ends when the transcript expects that judge closed with DEADLINE_EXCEEDED; a socket's deadline never does (no scenario covers it, link.e2e-spec does), so a slow key check cannot turn the Hello deadline into a dropped socket. */
export class ManualHandshakeClock implements HandshakeClock {
  /** By judge name: the newest session's Hello deadline. */
  private readonly hello = new Map<string, () => void>();

  arm(owner: HandshakeOwner, _ms: number, fire: () => void): () => void {
    if (!('judge' in owner)) return () => undefined;
    this.hello.set(owner.judge, fire);
    return () => {
      if (this.hello.get(owner.judge) === fire) this.hello.delete(owner.judge);
    };
  }

  /** Whether a session of `judge` waits for its Hello. */
  awaitsHello(judge: string): boolean {
    return this.hello.has(judge);
  }

  /** Ends `judge`'s Hello wait now if one is armed. */
  expireHello(judge: string): void {
    const fire = this.hello.get(judge);
    if (!fire) return;
    this.hello.delete(judge);
    fire();
  }
}
