interface Waiter {
  start: () => void;
  timer: NodeJS.Timeout;
}

/**
 * Runs at most `max` tasks at once; the others wait in arrival order, and one that has waited `maxWaitMs` is refused
 * with `refusal()` instead of running. A finished task hands its slot straight to the next waiter.
 */
export function concurrencyLimit(
  max: number,
  maxWaitMs: number,
  refusal: () => Error,
) {
  let running = 0;
  const waiting: Waiter[] = [];
  const acquire = (): Promise<void> => {
    if (running < max) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        start: resolve,
        timer: setTimeout(() => {
          waiting.splice(waiting.indexOf(waiter), 1);
          reject(refusal());
        }, maxWaitMs),
      };
      waiting.push(waiter);
    });
  };
  const release = (): void => {
    const next = waiting.shift();
    if (!next) {
      running--;
      return;
    }
    clearTimeout(next.timer);
    next.start();
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
