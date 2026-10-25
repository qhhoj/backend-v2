import type Redis from 'ioredis';
import { AppError } from '../errors/app.error';
import { RENEW_LOCK_SCRIPT, withRedisLock } from './redis-lock';

const lock = { key: 'k', ttlSeconds: 5, busyMessage: 'Busy, retry' };

describe('withRedisLock', () => {
  it('refuses a held lock with a 409 carrying the busy issue code', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue(null),
    } as unknown as Redis;
    const work = jest.fn();
    const error = await withRedisLock(redis, lock, work).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      extra: {
        issues: [{ field: 'lock', code: 'busy', message: 'Busy, retry' }],
      },
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('with waitSeconds, takes a lock released while it waits and runs the work once', async () => {
    const set = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('OK');
    const redis = { set, eval: jest.fn() } as unknown as Redis;
    const work = jest.fn().mockResolvedValue('done');
    await expect(
      withRedisLock(redis, { ...lock, waitSeconds: 5 }, work),
    ).resolves.toBe('done');
    expect(set).toHaveBeenCalledTimes(3);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('with waitSeconds, gives up with the busy conflict once the wait is over', async () => {
    const set = jest.fn().mockResolvedValue(null);
    const redis = { set } as unknown as Redis;
    const work = jest.fn();
    const error = await withRedisLock(
      redis,
      { ...lock, waitSeconds: 0.6 },
      work,
    ).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      status: 409,
      extra: { issues: [{ field: 'lock', code: 'busy' }] },
    });
    expect(set.mock.calls.length).toBeGreaterThan(1);
    expect(work).not.toHaveBeenCalled();
  });

  it('with renew, extends the lock while the work runs and stops once it ends', async () => {
    jest.useFakeTimers();
    try {
      const evalMock = jest.fn().mockResolvedValue(1);
      const redis = {
        set: jest.fn().mockResolvedValue('OK'),
        eval: evalMock,
      } as unknown as Redis;
      const work = withRedisLock(
        redis,
        { ...lock, renew: true },
        () =>
          new Promise<string>((resolve) => setTimeout(resolve, 5000, 'done')),
      );
      await jest.advanceTimersByTimeAsync(4900);
      const renewals = evalMock.mock.calls.filter(
        ([script]) => script === RENEW_LOCK_SCRIPT,
      );
      expect(renewals.length).toBeGreaterThanOrEqual(2);
      await jest.advanceTimersByTimeAsync(200);
      await expect(work).resolves.toBe('done');
      const after = evalMock.mock.calls.length;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(evalMock.mock.calls.length).toBe(after);
    } finally {
      jest.useRealTimers();
    }
  });

  it('without waitSeconds, tries the lock exactly once', async () => {
    const set = jest.fn().mockResolvedValue(null);
    const redis = { set } as unknown as Redis;
    await expect(withRedisLock(redis, lock, jest.fn())).rejects.toThrow(
      'Busy, retry',
    );
    expect(set).toHaveBeenCalledTimes(1);
  });
});
