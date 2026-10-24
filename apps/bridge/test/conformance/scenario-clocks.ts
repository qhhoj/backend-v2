import { waitUntil } from '@libs/common/testing';
import { AssignmentRef } from '@libs/judge-proto';
import type { Json } from '@libs/judge-proto/conformance/matcher';
import type { FakeJudge } from '../fake-judge';
import { ManualAcceptClock } from './manual-accept-clock';
import { ManualGraceClock } from './manual-grace-clock';
import { ManualHandshakeClock } from './manual-handshake-clock';
import { STEP_TIMEOUT_MS } from './runner';

/** The ref of an expected `kind` message (`{abort: {ref}}`), if the transcript names one. */
const refIn = (message: Json, kind: string): AssignmentRef | null => {
  const inner = (message as Record<string, Json> | null)?.[kind] as
    Record<string, Json> | undefined;
  return inner?.ref ? AssignmentRef.fromJSON(inner.ref) : null;
};

/** The bridge clocks the runner owns (every bridge it boots uses them), and the transcript steps that move each one: a host stall never decides an Assign's accept window, a lost judge's grace or a session's Hello deadline. */
export class ScenarioClocks {
  readonly accept = new ManualAcceptClock();
  readonly grace = new ManualGraceClock();
  readonly handshake = new ManualHandshakeClock();
  /** The flood cap's clock (`messageRateClock.now` while a scenario runs): it moves only with `pass`, so a `repeat` burst is one instant on any host. */
  private scriptedNow = Date.now();

  /** Before an expected bridge message (expanded): an Abort of a run whose accept window is armed is that window's timeout; an Assign of a later generation of a run in grace follows that grace's expiry. */
  beforeExpect(message: Json): void {
    const aborted = refIn(message, 'abort');
    if (aborted) this.accept.fire(aborted);
    const assigned = refIn(message, 'assign');
    if (assigned) this.grace.expireBefore(assigned);
  }

  /** Before an expected end of `judge`'s session: DEADLINE_EXCEEDED of a session waiting for its Hello is that deadline. The bridge arms it once the key check passed, so it is waited for until the stream ends some other way (an idle timeout). */
  async beforeClosed(
    judge: string,
    status: string,
    fake: FakeJudge,
  ): Promise<void> {
    if (status !== 'DEADLINE_EXCEEDED') return;
    await waitUntil(
      () => this.handshake.awaitsHello(judge) || fake.isClosed,
      STEP_TIMEOUT_MS,
    );
    this.handshake.expireHello(judge);
  }

  floodNow(): number {
    return this.scriptedNow;
  }

  /** A `wait` or `quiet` step: `ms` pass on the grace and flood clocks. */
  pass(ms: number): void {
    this.grace.advance(ms);
    this.scriptedNow += ms;
  }
}
