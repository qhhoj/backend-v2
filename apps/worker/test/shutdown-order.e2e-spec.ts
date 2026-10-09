import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { setupWorkerTest } from './setup';

/** The shared `REDIS` client serves running jobs (RedisCoalesce, locks, watermarks), so it may only quit after every BullMQ worker finished its job. Nest orders the two shutdown hooks by module position, which nothing else pins down. */
describe('worker shutdown order', () => {
  afterEach(() => jest.restoreAllMocks());

  it('quits the shared Redis client only after every BullMQ worker has closed', async () => {
    const events: string[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the worker as `this` below
    const close = Worker.prototype.close;
    jest.spyOn(Worker.prototype, 'close').mockImplementation(async function (
      this: Worker,
      force?: boolean,
    ) {
      await close.call(this, force);
      events.push('worker closed');
    });
    const worker = await setupWorkerTest();
    const redis = worker.module.get<Redis>(REDIS);
    const quit = redis.quit.bind(redis);
    jest.spyOn(redis, 'quit').mockImplementation(() => {
      events.push('redis quit');
      return quit();
    });

    await worker.teardown();

    expect(
      events.filter((event) => event === 'worker closed').length,
    ).toBeGreaterThan(0);
    expect(events.indexOf('redis quit')).toBe(events.length - 1);
  }, 60_000);
});
