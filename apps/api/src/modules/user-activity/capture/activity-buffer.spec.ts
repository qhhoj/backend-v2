import { ActivityBuffer } from './activity-buffer';

describe('ActivityBuffer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const make = (limits = { max: 5000, flushRows: 200, flushMs: 2000 }) => {
    const batches: number[][] = [];
    const errors: Array<[string, number]> = [];
    let fail = false;
    const buffer = new ActivityBuffer<number>(
      (rows) =>
        fail
          ? Promise.reject(new Error('mongo down'))
          : (batches.push(rows), Promise.resolve()),
      (error, dropped) => errors.push([error.message, dropped]),
      limits,
    );
    return {
      buffer,
      batches,
      errors,
      failNext: () => (fail = true),
      recover: () => (fail = false),
    };
  };

  it('flushes as soon as 200 rows are buffered, keeping order', async () => {
    const { buffer, batches } = make();
    for (let row = 0; row < 199; row += 1) buffer.add(row);
    await jest.advanceTimersByTimeAsync(0);
    expect(batches).toEqual([]);
    buffer.add(199);
    await jest.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(
      Array.from({ length: 200 }, (_value, row) => row),
    );
    expect(buffer.size()).toBe(0);
  });

  it('flushes what is left every two seconds, and writes nothing when empty', async () => {
    const { buffer, batches } = make();
    buffer.start();
    await jest.advanceTimersByTimeAsync(2000);
    expect(batches).toEqual([]);
    buffer.add(1);
    buffer.add(2);
    await jest.advanceTimersByTimeAsync(1999);
    expect(batches).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(batches).toEqual([[1, 2]]);
    await buffer.stop();
  });

  it('drops the oldest rows past the cap and reports how many', async () => {
    const { buffer, batches, errors } = make({
      max: 5,
      flushRows: 100,
      flushMs: 2000,
    });
    for (let row = 1; row <= 8; row += 1) buffer.add(row);
    expect(buffer.size()).toBe(5);
    await buffer.flush();
    expect(batches).toEqual([[4, 5, 6, 7, 8]]);
    expect(errors).toEqual([['activity buffer full', 3]]);
    await buffer.flush();
    expect(errors).toHaveLength(1);
  });

  it('keeps flowing after a failed write, reporting how many rows were dropped', async () => {
    const { buffer, batches, errors, failNext, recover } = make();
    failNext();
    buffer.add(1);
    buffer.add(2);
    await expect(buffer.flush()).resolves.toBeUndefined();
    expect(errors).toEqual([['mongo down', 2]]);
    recover();
    buffer.add(3);
    await buffer.flush();
    expect(batches).toEqual([[3]]);
  });

  it('never runs two writes at once', async () => {
    let running = 0;
    let peak = 0;
    const buffer = new ActivityBuffer<number>(
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 50));
        running -= 1;
      },
      () => undefined,
      { max: 5000, flushRows: 2, flushMs: 2000 },
    );
    for (let row = 0; row < 10; row += 1) buffer.add(row);
    const done = buffer.flush();
    await jest.advanceTimersByTimeAsync(500);
    await done;
    expect(peak).toBe(1);
  });

  it('writes the remainder when stopped, and stops the timer', async () => {
    const { buffer, batches } = make();
    buffer.start();
    buffer.add(9);
    await buffer.stop();
    expect(batches).toEqual([[9]]);
    buffer.add(10);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(batches).toEqual([[9]]);
  });
});
