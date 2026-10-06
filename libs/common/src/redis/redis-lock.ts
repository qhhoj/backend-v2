import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { AppError } from '../errors/app.error';

const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const logger = new Logger('RedisLock');

/** Runs `work` while holding `key` (expires after `ttlSeconds`); a held lock is a 409 `conflict` at once, no waiting. The owner-checked release never throws: a failure is logged, the work's result stands. */
export async function withRedisLock<Result>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  busyMessage: string,
  work: () => Promise<Result>,
): Promise<Result> {
  const token = randomBytes(16).toString('hex');
  if ((await redis.set(key, token, 'EX', ttlSeconds, 'NX')) !== 'OK')
    throw new AppError('conflict', 409, busyMessage);
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
