import { nextRetryDelay } from './commands.service';

describe('nextRetryDelay', () => {
  it('doubles the wait and never exceeds the cap', () => {
    expect(nextRetryDelay(1000)).toBe(2000);
    const delays = [1000];
    for (let step = 0; step < 20; step += 1)
      delays.push(nextRetryDelay(delays[step]));
    expect(Math.max(...delays)).toBe(30_000);
    expect(nextRetryDelay(30_000)).toBe(30_000);
  });
});
