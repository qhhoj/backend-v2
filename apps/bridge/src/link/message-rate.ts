const SECOND_MS = 1000;

/** Wall-clock time: what `messageRateClock` reads outside a conformance run. */
export const systemNow = (): number => Date.now();

/** The clock a `MessageRate` reads unless given its own. The conformance runner points it at the scenario's clock, so a scripted burst is one burst however slowly a loaded host reads it, and points it back at `systemNow`. */
export const messageRateClock = { now: systemNow };

/** Arrivals in a sliding second: a message is over the rate when `maxPerSecond` others arrived within the 1000 ms before it. A fixed window would let a burst that straddles its edge through twice over. */
export class MessageRate {
  /** Arrival times of the last `maxPerSecond` messages, as a ring; `next` holds the oldest. */
  private readonly arrivals: Float64Array;
  private next = 0;

  constructor(
    private readonly maxPerSecond: number,
    private readonly now: () => number = () => messageRateClock.now(),
  ) {
    this.arrivals = new Float64Array(maxPerSecond).fill(-Infinity);
  }

  /** Counts one arrival; false when it is over the rate. */
  admit(): boolean {
    const now = this.now();
    const oldest = this.arrivals[this.next];
    this.arrivals[this.next] = now;
    this.next = (this.next + 1) % this.maxPerSecond;
    return now - oldest >= SECOND_MS;
  }
}
