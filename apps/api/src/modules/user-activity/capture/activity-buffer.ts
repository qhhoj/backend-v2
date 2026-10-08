import {
  ACTIVITY_BUFFER_MAX,
  ACTIVITY_FLUSH_MS,
  ACTIVITY_FLUSH_ROWS,
} from '@libs/community';

interface BufferLimits {
  max: number;
  flushRows: number;
  flushMs: number;
}

/** Bounded in-memory buffer (legacy `deque(maxlen=5000)`): the oldest rows go when it is full, a flush starts at `flushRows` rows or every `flushMs`, flushes never overlap, and a failed write drops its batch instead of growing memory. Both kinds of loss are reported through `onError` with the number of rows lost; `add` never waits. */
export class ActivityBuffer<Row> {
  private rows: Row[] = [];
  private overflowed = 0;
  private timer?: NodeJS.Timeout;
  private chain: Promise<void> = Promise.resolve();
  private sizeFlushQueued = false;

  constructor(
    private readonly sink: (rows: Row[]) => Promise<void>,
    private readonly onError: (error: Error, dropped: number) => void,
    private readonly limits: BufferLimits = {
      max: ACTIVITY_BUFFER_MAX,
      flushRows: ACTIVITY_FLUSH_ROWS,
      flushMs: ACTIVITY_FLUSH_MS,
    },
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.limits.flushMs);
    this.timer.unref();
  }

  size(): number {
    return this.rows.length;
  }

  add(row: Row): void {
    this.rows.push(row);
    if (this.rows.length > this.limits.max) {
      this.rows.shift();
      this.overflowed += 1;
    }
    if (this.rows.length >= this.limits.flushRows && !this.sizeFlushQueued) {
      this.sizeFlushQueued = true;
      void this.flush();
    }
  }

  /** Writes what is buffered after any write still running; never rejects. */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drain());
    return this.chain;
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  private async drain(): Promise<void> {
    this.sizeFlushQueued = false;
    if (this.overflowed) {
      this.onError(new Error('activity buffer full'), this.overflowed);
      this.overflowed = 0;
    }
    const batch = this.rows.splice(0);
    if (!batch.length) return;
    try {
      await this.sink(batch);
    } catch (error) {
      this.onError(error as Error, batch.length);
    }
  }
}
