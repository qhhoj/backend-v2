/** Runs at most `max` tasks at once; the others wait in arrival order. A finished task hands its slot straight to the next waiter. */
export function concurrencyLimit(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (running < max) {
      running++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  return async <Result>(task: () => Promise<Result>): Promise<Result> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
