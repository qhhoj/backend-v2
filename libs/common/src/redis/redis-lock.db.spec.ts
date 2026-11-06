import Redis from 'ioredis';
import { TEST_REDIS_URL } from '../testing';
import {
  keepLockAlive,
  newLockToken,
  releaseLock,
  tryLock,
} from './redis-lock';

describe('lock ownership in Redis', () => {
  const redis = new Redis(TEST_REDIS_URL);
  const key = `lock-spec:${Date.now()}`;
  const markKey = `${key}:mark`;
  afterAll(async () => {
    await redis.del(key, markKey);
    await redis.quit();
  });
  beforeEach(() => redis.del(key, markKey));

  it('is taken by one token at a time and released only by its owner', async () => {
    const owner = newLockToken();
    expect(await tryLock(redis, key, owner, 30)).toBe(true);
    expect(await tryLock(redis, key, newLockToken(), 30)).toBe(false);
    await releaseLock(redis, key, newLockToken());
    expect(await redis.exists(key)).toBe(1);
    await releaseLock(redis, key, owner);
    expect(await redis.exists(key)).toBe(0);
  });

  it('extends the lock while held and never creates a missing mark', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const owner = newLockToken();
      await tryLock(redis, key, owner, 100);
      const stop = keepLockAlive(redis, [key, markKey], owner, 3);
      await jest.advanceTimersByTimeAsync(1100);
      stop();
      expect(await redis.ttl(key)).toBeLessThanOrEqual(3);
      expect(await redis.exists(markKey)).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not extend a lock another token now holds', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      await tryLock(redis, key, newLockToken(), 3);
      const stop = keepLockAlive(redis, [key], newLockToken(), 100);
      await jest.advanceTimersByTimeAsync(34_000);
      stop();
      expect(await redis.ttl(key)).toBeLessThanOrEqual(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
