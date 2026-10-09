import type Redis from 'ioredis';
import { AppError } from '../errors/app.error';
import { withRedisLock } from './redis-lock';

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

  it('runs the work and releases an acquired lock', async () => {
    const evalMock = jest.fn().mockResolvedValue(1);
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: evalMock,
    } as unknown as Redis;
    await expect(
      withRedisLock(redis, lock, () => Promise.resolve(7)),
    ).resolves.toBe(7);
    expect(evalMock).toHaveBeenCalledTimes(1);
  });
});
