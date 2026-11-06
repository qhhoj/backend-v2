import type Redis from 'ioredis';
import {
  keepLockAlive,
  logRedisFailure,
  newLockToken,
  releaseLock,
  tryLock,
} from './redis-lock';

/** How long a crashed owner keeps the key; a live owner extends the lock and the pending mark every third of this while `work` runs, so no recompute length lets a second owner in. Its pending mark expires with it (the effects sweep catches up). */
export const COALESCE_TTL_SECONDS = 60;

/**
 * Runs `work` for `key` so it never runs twice at once, across processes, and always runs once more after the last call: a caller marks the key dirty, then either becomes the owner, which reruns `work` until nobody marked it again, or leaves the work to the current owner and returns.
 * Recomputes are reads followed by `$set`; without this, two interleaved recomputes could write the older result last. Bursts collapse: 100 graded submissions on one problem cost a few stats recomputes, not 100. While marks keep arriving the owner keeps looping, so its caller (a queue job) stays busy; that is a hot key, not a hang.
 * Resolves false when the work was left to another owner: a caller that must know its change was applied (a due stamp it clears) keeps its stamp then, since that owner may still die.
 */
export async function runCoalesced(
  redis: Redis,
  key: string,
  work: () => Promise<void>,
  ttlSeconds = COALESCE_TTL_SECONDS,
): Promise<boolean> {
  const dirtyKey = `${key}:dirty`;
  const lockKey = `${key}:lock`;
  const token = newLockToken();
  const markDirty = () => redis.set(dirtyKey, '1', 'EX', ttlSeconds);
  await markDirty();
  let isOwner = false;
  while (await tryLock(redis, lockKey, token, ttlSeconds)) {
    isOwner = true;
    // A visitor's mark must not expire while the owner still runs.
    const stopHeartbeat = keepLockAlive(
      redis,
      [lockKey, dirtyKey],
      token,
      ttlSeconds,
    );
    try {
      while ((await redis.getdel(dirtyKey)) !== null) await work();
    } catch (error) {
      await markDirty().catch((failure: unknown) =>
        logRedisFailure(`Mark ${dirtyKey} restore`, failure),
      );
      throw error;
    } finally {
      stopHeartbeat();
      await releaseLock(redis, lockKey, token);
    }
    // A caller that marked the key after the last check saw the lock held and left: run for it.
    if (!(await redis.exists(dirtyKey))) return true;
  }
  return isOwner;
}
