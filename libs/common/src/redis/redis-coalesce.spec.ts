import Redis from 'ioredis';
import { TEST_REDIS_URL } from '../testing';
import { COALESCE_TTL_SECONDS, runCoalesced } from './redis-coalesce';

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('runCoalesced', () => {
  const redis = new Redis(TEST_REDIS_URL);
  /** A second client stands for a second worker process. */
  const otherProcess = new Redis(TEST_REDIS_URL);
  let key = '';
  let keys = 0;
  beforeEach(() => {
    keys += 1;
    key = `coalesce-spec:${Date.now()}:${keys}`;
  });
  afterAll(async () => {
    await redis.quit();
    await otherProcess.quit();
  });

  it('never runs work twice at once and always runs once after the last call', async () => {
    let running = 0;
    let maxRunning = 0;
    let value = 0;
    const seen: number[] = [];
    const work = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      const read = value;
      await sleep(20);
      seen.push(read);
      running -= 1;
    };
    const calls: Array<Promise<void>> = [];
    for (let call = 1; call <= 10; call += 1) {
      value = call;
      calls.push(runCoalesced(call % 2 ? redis : otherProcess, key, work));
      await sleep(5);
    }
    await Promise.all(calls);
    expect(maxRunning).toBe(1);
    expect(seen.at(-1)).toBe(10);
  });

  it('returns at once while another process owns the key, which then runs again for it', async () => {
    let ownerRuns = 0;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const owner = runCoalesced(redis, key, async () => {
      ownerRuns += 1;
      if (ownerRuns === 1) await gate;
    });
    await sleep(20);
    const visitorWork = jest.fn(() => Promise.resolve());
    await runCoalesced(otherProcess, key, visitorWork);
    expect(visitorWork).not.toHaveBeenCalled();
    open();
    await owner;
    expect(ownerRuns).toBe(2);
  });

  it('rethrows a failed run and leaves the key for the next call', async () => {
    await expect(
      runCoalesced(redis, key, () => Promise.reject(new Error('mongo down'))),
    ).rejects.toThrow('mongo down');
    const work = jest.fn(() => Promise.resolve());
    await runCoalesced(redis, key, work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('frees the key of a crashed owner after its time to live', async () => {
    await redis.set(`${key}:lock`, 'crashed', 'EX', 1);
    const work = jest.fn(() => Promise.resolve());
    await runCoalesced(redis, key, work);
    expect(work).not.toHaveBeenCalled();
    const ttl = await redis.ttl(`${key}:dirty`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(COALESCE_TTL_SECONDS);
    await sleep(1100);
    await runCoalesced(redis, key, work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('keeps the lock and the marks of visitors during a recompute that outlives the time to live: no second owner at once, and a run for the visitor after', async () => {
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    const work = async () => {
      running += 1;
      runs += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(runs === 1 ? 2500 : 10);
      running -= 1;
    };
    const owner = runCoalesced(redis, key, work, 1);
    await sleep(500);
    await runCoalesced(otherProcess, key, work, 1);
    await owner;
    expect(maxRunning).toBe(1);
    expect(runs).toBe(2);
  }, 15_000);
});
