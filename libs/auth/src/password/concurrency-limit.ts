interface Waiter {
  start: () => void;
  timer: NodeJS.Timeout;
}

/** Who a task is queued for; a task without one gets a lane of its own. */
export type Lane = string | symbol;

export interface ConcurrencyLimits {
  /** Tasks running at once. */
  slots: number;
  /** Tasks one lane may hold, running or waiting; one more is refused at once. */
  perLane: number;
  /** A task still waiting for a slot after this long is refused instead of running. */
  maxWaitMs: number;
}

class LaneLimiter {
  private running = 0;
  /** Map order is the turn order: a lane that was just served moves to the back. */
  private readonly waiting = new Map<Lane, Waiter[]>();
  private readonly held = new Map<Lane, number>();

  constructor(
    private readonly limits: ConcurrencyLimits,
    private readonly refusal: () => Error,
  ) {}

  async run<Result>(task: () => Promise<Result>, lane: Lane): Promise<Result> {
    const holding = this.held.get(lane) ?? 0;
    if (holding >= this.limits.perLane) throw this.refusal();
    this.held.set(lane, holding + 1);
    try {
      await this.acquire(lane);
      try {
        return await task();
      } finally {
        this.release();
      }
    } finally {
      this.leave(lane);
    }
  }

  private acquire(lane: Lane): Promise<void> {
    if (this.running < this.limits.slots) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        start: resolve,
        timer: setTimeout(() => {
          this.dequeue(lane, waiter);
          reject(this.refusal());
        }, this.limits.maxWaitMs),
      };
      const queue = this.waiting.get(lane);
      if (queue) queue.push(waiter);
      else this.waiting.set(lane, [waiter]);
    });
  }

  /** Hands the slot straight to the first waiter of the lane whose turn it is, and sends that lane to the back. */
  private release(): void {
    const turn = this.waiting.entries().next();
    if (turn.done) {
      this.running--;
      return;
    }
    const [lane, queue] = turn.value;
    const next = queue.shift()!;
    this.waiting.delete(lane);
    if (queue.length) this.waiting.set(lane, queue);
    clearTimeout(next.timer);
    next.start();
  }

  private dequeue(lane: Lane, waiter: Waiter): void {
    const queue = this.waiting.get(lane) ?? [];
    queue.splice(queue.indexOf(waiter), 1);
    if (!queue.length) this.waiting.delete(lane);
  }

  private leave(lane: Lane): void {
    const holding = (this.held.get(lane) ?? 1) - 1;
    if (holding) this.held.set(lane, holding);
    else this.held.delete(lane);
  }
}

/**
 * Runs at most `slots` tasks at once. The others wait in their lane, in arrival order, and a freed slot goes to the
 * waiting lanes in turn (round-robin), so a lane with a long backlog delays another lane's task by at most one task per
 * slot. Refusals (`refusal()`): a lane already holding `perLane` tasks, and a task that waited `maxWaitMs`.
 */
export function concurrencyLimit(
  limits: ConcurrencyLimits,
  refusal: () => Error,
) {
  const limiter = new LaneLimiter(limits, refusal);
  return <Result>(
    task: () => Promise<Result>,
    lane: Lane = Symbol('task'),
  ): Promise<Result> => limiter.run(task, lane);
}
