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
  requeueWhenStalledOut: true,
  describe: ({ id }) => `Rescore ${id}`,
});
/** Same retries, no opt-in: stays failed. */
const plainJob = defineJob<{ id: string }>({
  queue: 'spec-stalled',
  name: 'plain',
  options: { ...JOB_RETRY, ...JOB_RETENTION },
  describe: ({ id }) => `Plain ${id}`,
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
  /** Workers a spec started, closed after it even when it fails. */
  const started: Worker[] = [];
  const track = (worker: Worker): Worker => {
    started.push(worker);
    return worker;
  };
  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(started.splice(0).map((worker) => worker.close(true)));
  });
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
    await queue.add(
      'rescore',
      { id: 'c1' },
      {
        ...stalledRescore.options,
        jobId: 'c1',
      },
    );
    const stallChecker = track(
      new Worker(queue.name, null, { connection, ...FAST }),
    );
    await stallChecker.startStalledCheckTimer();
    await killedWorker();
    await waitUntil(async () => (await queue.getWaitingCount()) === 1);
    await killedWorker();

    const runsOf: { id?: string; attempts?: number }[] = [];
    const healthy = track(
      new Worker(
        queue.name,
        (run: Job) => {
          runsOf.push({ id: run.id, attempts: run.opts.attempts });
          return Promise.resolve();
        },
        { connection, ...FAST },
      ),
    );
    healthy.on('failed', (job: Job | undefined, error: Error) => {
      void processor.failed(job, error);
    });
    await waitUntil(() => runsOf.length === 1, 15_000);
    await waitUntil(
      async () =>
        (await queue.getJobCounts('wait', 'active', 'failed')).wait === 0,
    );
    expect(runsOf).toEqual([{ id: 'c1', attempts: 2 }]);
    expect(
      await queue.getJobCounts('wait', 'active', 'failed', 'delayed'),
    ).toMatchObject({ wait: 0, active: 0, failed: 0, delayed: 0 });
  }, 30_000);

  it('does not queue a stalled-out job again unless its contract opts in', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    class Plain extends JobProcessor<{ id: string }>(plainJob) {
      run(): Promise<unknown> {
        return Promise.resolve();
      }
    }
    const processor = new Plain();
    Object.assign(processor, { moduleRef: { get: () => queue } });
    const add = jest.fn();
    Object.assign(processor, { moduleRef: { get: () => ({ add }) } });
    const job = await queue.add('plain', { id: 'p1' }, plainJob.options);
    await processor.failed(
      job,
      new Error('job stalled more than allowable limit'),
    );
    expect(add).not.toHaveBeenCalled();
  });
});
