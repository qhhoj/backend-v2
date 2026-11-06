/** Rejects after `timeoutMs` when `pending` has not settled; `pending` itself keeps running (an ioredis offline-queued command is still delivered when Redis returns). */
export function withinTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}
