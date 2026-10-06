import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { RELEASE_LOCK_SCRIPT } from './redis-lock';

/** How long a crashed owner keeps the key; a live owner extends it every third of this while `work` runs, so no recompute length lets a second owner in. Its pending mark expires with it (the effects sweep catches up). */
export const COALESCE_TTL_SECONDS = 60;

const EXTEND_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0";
const logger = new Logger('RedisCoalesce');

/**
 * Runs `work` for `key` so it never runs twice at once, across processes, and always runs once more after the last call: a caller marks the key dirty, then either becomes the owner, which reruns `work` until nobody marked it again, or leaves the work to the current owner and returns.
 * Recomputes are reads followed by `$set`; without this, two interleaved recomputes could write the older result last. Bursts collapse: 100 graded submissions on one problem cost a few stats recomputes, not 100.
 */
export async function runCoalesced(
  redis: Redis,
  key: string,
  work: () => Promise<void>,
  ttlSeconds = COALESCE_TTL_SECONDS,
): Promise<void> {
  const dirtyKey = `${key}:dirty`;
  const lockKey = `${key}:lock`;
  const token = randomBytes(16).toString('hex');
  const markDirty = () => redis.set(dirtyKey, '1', 'EX', ttlSeconds);
  await markDirty();
  while ((await redis.set(lockKey, token, 'EX', ttlSeconds, 'NX')) === 'OK') {
    const heartbeat = setInterval(
      () => {
        redis
          .eval(EXTEND_LOCK_SCRIPT, 1, lockKey, token, ttlSeconds)
          .catch((error: Error) =>
            logger.error(`Lock ${lockKey} extension failed: ${error.message}`),
          );
      },
      (ttlSeconds * 1000) / 3,
    );
    try {
      while ((await redis.getdel(dirtyKey)) !== null) await work();
    } catch (error) {
      await markDirty();
      throw error;
    } finally {
      clearInterval(heartbeat);
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
    }
    // A caller that marked the key after the last check saw the lock held and left: run for it.
    if (!(await redis.exists(dirtyKey))) return;
  }
}
