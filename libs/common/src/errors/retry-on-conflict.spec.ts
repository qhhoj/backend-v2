import { retryOnConflict } from './retry-on-conflict';

const losing = (losses: number) => {
  let calls = 0;
  return {
    attempt: () => {
      calls += 1;
      return Promise.resolve(calls > losses);
    },
    calls: () => calls,
  };
};

describe('retryOnConflict', () => {
  it('stops at the first win', async () => {
    const run = losing(1);
    await expect(retryOnConflict(run.attempt, 3)).resolves.toBe(true);
    expect(run.calls()).toBe(2);
  });

  it('wins on the last allowed attempt, and gives up one loss later', async () => {
    await expect(retryOnConflict(losing(2).attempt, 3)).resolves.toBe(true);
    const run = losing(3);
    await expect(retryOnConflict(run.attempt, 3)).resolves.toBe(false);
    expect(run.calls()).toBe(3);
  });

  it('does not retry an error, and never runs for zero attempts', async () => {
    const attempt = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(retryOnConflict(attempt, 3)).rejects.toThrow('boom');
    expect(attempt).toHaveBeenCalledTimes(1);
    await expect(retryOnConflict(attempt, 0)).resolves.toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
