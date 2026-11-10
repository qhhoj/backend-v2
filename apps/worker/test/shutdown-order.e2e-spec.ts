// Not in the package index: its `onApplicationShutdown` is BullMQ's own close of the workers, the phase the drain must precede.
import { BullExplorer } from '@nestjs/bullmq/dist/bull.explorer';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { setupWorkerTest } from './setup';

/** The shared `REDIS` client serves running jobs (RedisCoalesce, locks, watermarks), so it may only quit after every BullMQ worker finished its job (`JobWorkersDrain`), wherever the modules sit in the list. */
describe('worker shutdown order', () => {
  afterEach(() => jest.restoreAllMocks());

  it('closes every BullMQ worker before the shutdown phase, and quits the shared Redis client after them', async () => {
    const events: string[] = [];
    const closed = new Set<Worker>();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the worker as `this` below
    const close = Worker.prototype.close;
    jest.spyOn(Worker.prototype, 'close').mockImplementation(async function (
      this: Worker,
      force?: boolean,
    ) {
      await close.call(this, force);
      // Closing again (BullMQ's own hook after the drain) returns the first close's promise: count each worker once.
      if (!closed.has(this)) events.push('worker closed');
      closed.add(this);
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the explorer as `this` below
    const explorerShutdown = BullExplorer.prototype.onApplicationShutdown;
    jest
      .spyOn(BullExplorer.prototype, 'onApplicationShutdown')
      .mockImplementation(function (this: BullExplorer, signal?: string) {
        events.push('shutdown phase');
        return explorerShutdown.call(this, signal);
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
    // Without the drain the workers close only inside BullMQ's own shutdown hook, whatever the module order.
    expect(events.lastIndexOf('worker closed')).toBeLessThan(
      events.indexOf('shutdown phase'),
    );
    expect(events.indexOf('redis quit')).toBeGreaterThan(
      events.lastIndexOf('worker closed'),
    );
  }, 60_000);
});
