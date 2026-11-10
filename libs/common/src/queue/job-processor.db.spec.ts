import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { TEST_REDIS_URL, waitUntil } from '../testing';
import { defineJob, JOB_RETENTION, JOB_RETRY } from './job-contract';
import { JobProcessor } from './job-processor';

const connection = { url: TEST_REDIS_URL };
/** BullMQ's defaults (30 s) cut to the test's scale. */
const FAST = { lockDuration: 1000, stalledInterval: 500 };
const stalledRescore = defineJob<{ id: string }>({
  queue: 'spec-stalled',
  name: 'rescore',
  options: { ...JOB_RETRY, ...JOB_RETENTION },
  describe: ({ id }) => `Rescore ${id}`,
});

class Spec extends JobProcessor<{ id: string }>(stalledRescore) {
  run(): Promise<unknown> {
    return Promise.resolve();
  }
}

describe('JobProcessor against Redis', () => {
  let queue: Queue;
  beforeAll(() => {
    queue = new Queue(stalledRescore.queue, { connection });
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  /** A worker that takes the job and dies without releasing it. */
  const killedWorker = async () => {
    const worker = new Worker(queue.name, () => new Promise(() => undefined), {
      connection,
      ...FAST,
      skipLockRenewal: true,
      skipStalledCheck: true,
    });
    await waitUntil(async () => (await queue.getActiveCount()) === 1);
    await worker.close(true);
  };

  it('runs a job again that stalled out of its allowed stalls, while attempts are left', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const processor = new Spec();
    Object.assign(processor, { moduleRef: { get: () => queue } });
    await queue.add('rescore', { id: 'c1' }, stalledRescore.options);
    const stallChecker = new Worker(queue.name, null, { connection, ...FAST });
    await stallChecker.startStalledCheckTimer();
    await killedWorker();
    await waitUntil(async () => (await queue.getWaitingCount()) === 1);
    await killedWorker();

    let runs = 0;
    const healthy = new Worker(
      queue.name,
      () => {
        runs += 1;
        return Promise.resolve();
      },
      { connection, ...FAST },
    );
    healthy.on('failed', (job: Job | undefined, error: Error) => {
      void processor.failed(job, error);
    });
    await waitUntil(() => runs === 1, 15_000);
    await healthy.close();
    await stallChecker.close();
    expect(runs).toBe(1);
    jest.restoreAllMocks();
  }, 30_000);
});
