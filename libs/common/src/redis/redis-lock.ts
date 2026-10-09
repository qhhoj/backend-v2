import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { conflictIssue } from '../errors/conflict-issue';

export const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const logger = new Logger('RedisLock');

/** Runs `work` while holding `key` (expires after `ttlSeconds`); a held lock is a 409 `conflict` at once, no waiting, with `issues: [{ field: 'lock', code: 'busy', message }]`. The owner-checked release never throws: a failure is logged, the work's result stands. */
export async function withRedisLock<Result>(
  redis: Redis,
  lock: { key: string; ttlSeconds: number; busyMessage: string },
  work: () => Promise<Result>,
): Promise<Result> {
  const { key, ttlSeconds, busyMessage } = lock;
  const token = randomBytes(16).toString('hex');
  if ((await redis.set(key, token, 'EX', ttlSeconds, 'NX')) !== 'OK')
    throw conflictIssue('lock', 'busy', busyMessage);
  try {
    return await work();
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
    } catch (error) {
      logger.error(`Lock ${key} release failed: ${(error as Error).message}`);
    }
  }
}
