interface Waiter {
  start: () => void;
  timer: NodeJS.Timeout;
}

type Key = string | symbol;

/** Who a task is queued for: a lane (one client), inside a group of lanes (the client's network). */
export interface Requester {
  lane: Key;
  group: Key;
}

export interface ConcurrencyLimits {
  /** Tasks running at once. */
  slots: number;
  /** Tasks one lane may hold, running or waiting; one more is refused at once. */
  perLane: number;
  /** A task still waiting for a slot after this long is refused instead of running. */
  maxWaitMs: number;
}

/** Shifts the first item of the first queue and sends that queue to the back of the turn order (drops it once empty). */
function takeTurn<Item>(queues: Map<Key, Item[]>): Item {
  const [key, queue] = queues.entries().next().value as [Key, Item[]];
  const item = queue.shift()!;
  queues.delete(key);
  if (queue.length) queues.set(key, queue);
  return item;
}

class LaneLimiter {
  private running = 0;
  /** Waiting tasks per group, then per lane. Map order is the turn order at both levels: whatever was just served moves to the back. */
  private readonly waiting = new Map<Key, Map<Key, Waiter[]>>();
  private readonly held = new Map<Key, number>();

  constructor(
    private readonly limits: ConcurrencyLimits,
    private readonly refusal: () => Error,
  ) {}

  async run<Result>(
    task: () => Promise<Result>,
    requester: Requester,
  ): Promise<Result> {
    const holding = this.held.get(requester.lane) ?? 0;
    if (holding >= this.limits.perLane) throw this.refusal();
    this.held.set(requester.lane, holding + 1);
    try {
      await this.acquire(requester);
      try {
        return await task();
      } finally {
        this.release();
      }
    } finally {
      this.leave(requester.lane);
    }
  }

  private acquire(requester: Requester): Promise<void> {
    if (this.running < this.limits.slots) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        start: resolve,
        timer: setTimeout(() => {
          this.dequeue(requester, waiter);
          reject(this.refusal());
        }, this.limits.maxWaitMs),
      };
      this.queueOf(requester).push(waiter);
    });
  }

  private queueOf({ lane, group }: Requester): Waiter[] {
    const lanes = this.waiting.get(group) ?? new Map<Key, Waiter[]>();
    this.waiting.set(group, lanes);
    const queue = lanes.get(lane) ?? [];
    lanes.set(lane, queue);
    return queue;
  }

  /** Hands the slot straight to the next waiter: the group whose turn it is, then the lane whose turn it is inside it. */
  private release(): void {
    const turn = this.waiting.entries().next();
    if (turn.done) {
      this.running--;
      return;
    }
    const [group, lanes] = turn.value;
    const next = takeTurn(lanes);
    this.waiting.delete(group);
    if (lanes.size) this.waiting.set(group, lanes);
    clearTimeout(next.timer);
    next.start();
  }

  private dequeue({ lane, group }: Requester, waiter: Waiter): void {
    const lanes = this.waiting.get(group);
    const queue = lanes?.get(lane);
    if (!lanes || !queue) return;
    queue.splice(queue.indexOf(waiter), 1);
    if (!queue.length) lanes.delete(lane);
    if (!lanes.size) this.waiting.delete(group);
  }

  private leave(lane: Key): void {
    const holding = (this.held.get(lane) ?? 1) - 1;
    if (holding) this.held.set(lane, holding);
    else this.held.delete(lane);
  }
}

/** A lane and a group no other task shares. */
const ownLane = (): Requester => ({
  lane: Symbol('task'),
  group: Symbol('task'),
});

/**
 * Runs at most `slots` tasks at once. The others wait in their lane, in arrival order, and a freed slot goes to the
 * waiting groups in turn, and inside a group to its waiting lanes in turn (round-robin at both levels), so a group with
 * a long backlog, however many lanes it spreads it over, delays another group's task by at most one task per slot.
 * Refusals (`refusal()`): a lane already holding `perLane` tasks, and a task that waited `maxWaitMs`.
 */
export function concurrencyLimit(
  limits: ConcurrencyLimits,
  refusal: () => Error,
) {
  const limiter = new LaneLimiter(limits, refusal);
  return <Result>(
    task: () => Promise<Result>,
    requester: Requester = ownLane(),
  ): Promise<Result> => limiter.run(task, requester);
}
