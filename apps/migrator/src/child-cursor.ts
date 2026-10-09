/** Streams child rows ordered by their parent key and hands them out per parent batch, so memory stays one batch (1.5M test cases never sit in memory). */
export class ChildCursor<Child extends object> {
  private readonly iterator: AsyncIterator<Child>;
  private pending: Child | null = null;
  private finished = false;

  constructor(
    rows: AsyncIterable<Child>,
    private readonly key: keyof Child & string,
  ) {
    this.iterator = rows[Symbol.asyncIterator]();
  }

  /** Every child whose key is at most `lastParentId`, grouped by key. */
  async takeThrough(lastParentId: number): Promise<Map<number, Child[]>> {
    const groups = new Map<number, Child[]>();
    for (
      let child = await this.peek();
      child && this.keyOf(child) <= lastParentId;
      child = await this.peek()
    ) {
      const key = this.keyOf(child);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(child);
      this.pending = null;
    }
    return groups;
  }

  /** Reads what is left (children whose parent row does not exist) and returns how many there were. */
  async drain(): Promise<number> {
    let count = 0;
    while (await this.peek()) {
      count += 1;
      this.pending = null;
    }
    return count;
  }

  /** Ends the underlying stream early (a failed job), which releases its pooled connection. */
  async close(): Promise<void> {
    this.finished = true;
    this.pending = null;
    await this.iterator.return?.();
  }

  private keyOf(child: Child): number {
    return Number(child[this.key]);
  }

  private async peek(): Promise<Child | null> {
    if (this.pending || this.finished) return this.pending;
    const next = await this.iterator.next();
    if (next.done) {
      this.finished = true;
      return null;
    }
    this.pending = next.value;
    return this.pending;
  }
}
