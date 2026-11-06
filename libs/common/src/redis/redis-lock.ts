import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type Redis from 'ioredis';
import { conflictIssue } from '../errors/conflict-issue';

export const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
/** Owner-checked: extends the lock `KEYS[1]` and every further key (`EXPIRE` of a missing key is a no-op) only while `ARGV[1]` still holds the lock. */
export const EXTEND_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then for index = 2, #KEYS do redis.call('EXPIRE', KEYS[index], ARGV[2]) end return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0";
const logger = new Logger('RedisLock');

/** How often a waiting lock taker tries the lock again. */
const LOCK_RETRY_MS = 250;

export interface RedisLock {
  key: string;
  ttlSeconds: number;
  busyMessage: string;
  /** How long a held lock is waited for, retried every LOCK_RETRY_MS; 0 (the default) refuses it at once. */
  waitSeconds?: number;
  /** Extends the expiry while `work` runs (see `keepLockAlive`): for slow work such as a queued password hash. */
  renew?: boolean;
}

/** Runs `work` while holding `key` (expires after `ttlSeconds`); a lock still held after `waitSeconds` (default: at once) is a 409 `conflict` with `issues: [{ field: 'lock', code: 'busy', message }]`. The release never throws. */
export async function withRedisLock<Result>(
  redis: Redis,
  lock: RedisLock,
  work: () => Promise<Result>,
): Promise<Result> {
  const token = newLockToken();
  if (!(await acquire(redis, lock, token)))
    throw conflictIssue('lock', 'busy', lock.busyMessage);
  const stopRenewal = lock.renew
    ? keepLockAlive(redis, [lock.key], token, lock.ttlSeconds)
    : null;
  try {
    return await work();
  } finally {
    stopRenewal?.();
    await releaseLock(redis, lock.key, token);
  }
}

export const newLockToken = () => randomBytes(16).toString('hex');

/** SET NX with an expiry; true when `token` now holds `key`. */
export async function tryLock(
  redis: Redis,
  key: string,
  token: string,
  ttlSeconds: number,
): Promise<boolean> {
  return (await redis.set(key, token, 'EX', ttlSeconds, 'NX')) === 'OK';
}

/** SET NX until it succeeds or `waitSeconds` are over; true when `token` holds the lock. */
async function acquire(
  redis: Redis,
  { key, ttlSeconds, waitSeconds = 0 }: RedisLock,
  token: string,
): Promise<boolean> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    if (await tryLock(redis, key, token, ttlSeconds)) return true;
    if (Date.now() + LOCK_RETRY_MS > deadline) return false;
    await sleep(LOCK_RETRY_MS);
  }
}

/** Extends the lock and `alsoKeys` every third of `ttlSeconds` until the returned function is called, so slow work never outlives its lock; a crashed process still frees it after `ttlSeconds`. */
export function keepLockAlive(
  redis: Redis,
  [key, ...alsoKeys]: string[],
  token: string,
  ttlSeconds: number,
): () => void {
  const timer = setInterval(
    () => {
      redis
        .eval(
          EXTEND_LOCK_SCRIPT,
          1 + alsoKeys.length,
          key,
          ...alsoKeys,
          token,
          ttlSeconds,
        )
        .catch(logRedisFailure(`Lock ${key} extension`));
    },
    (ttlSeconds * 1000) / 3,
  );
  timer.unref();
  return () => clearInterval(timer);
}

/** Owner-checked release. Redis failing after the work ran must not mask the work's own error or fail a run that succeeded: a failure is logged and the expiry recovers. */
export async function releaseLock(
  redis: Redis,
  key: string,
  token: string,
): Promise<void> {
  try {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  } catch (error) {
    logRedisFailure(`Lock ${key} release`)(error as Error);
  }
}

export const logRedisFailure = (what: string) => (error: Error) =>
  logger.error(`${what} failed: ${error.message}`);
