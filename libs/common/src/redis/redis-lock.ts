import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type Redis from 'ioredis';
import { conflictIssue } from '../errors/conflict-issue';

export const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const logger = new Logger('RedisLock');

/** How often a waiting lock taker tries the lock again. */
const LOCK_RETRY_MS = 250;

export interface RedisLock {
  key: string;
  ttlSeconds: number;
  busyMessage: string;
  /** How long a held lock is waited for, retried every LOCK_RETRY_MS; 0 (the default) refuses it at once. */
  waitSeconds?: number;
}

/** Runs `work` while holding `key` (expires after `ttlSeconds`); a lock still held after `waitSeconds` (default: at once) is a 409 `conflict` with `issues: [{ field: 'lock', code: 'busy', message }]`. The owner-checked release never throws: a failure is logged, the work's result stands. */
export async function withRedisLock<Result>(
  redis: Redis,
  lock: RedisLock,
  work: () => Promise<Result>,
): Promise<Result> {
  const token = randomBytes(16).toString('hex');
  if (!(await acquire(redis, lock, token)))
    throw conflictIssue('lock', 'busy', lock.busyMessage);
  try {
    return await work();
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lock.key, token);
    } catch (error) {
      logger.error(
        `Lock ${lock.key} release failed: ${(error as Error).message}`,
      );
    }
  }
}

/** SET NX until it succeeds or `waitSeconds` are over; true when `token` holds the lock. */
async function acquire(
  redis: Redis,
  { key, ttlSeconds, waitSeconds = 0 }: RedisLock,
  token: string,
): Promise<boolean> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    if ((await redis.set(key, token, 'EX', ttlSeconds, 'NX')) === 'OK')
      return true;
    if (Date.now() + LOCK_RETRY_MS > deadline) return false;
    await sleep(LOCK_RETRY_MS);
  }
}
