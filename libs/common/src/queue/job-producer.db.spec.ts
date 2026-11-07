import { Queue, Worker } from 'bullmq';
import { TEST_REDIS_URL, waitUntil } from '../testing';
import { defineJob } from './job-contract';
import { JobProducer } from './job-producer';
import { onDemandState } from './on-demand';

const connection = { url: TEST_REDIS_URL };
const build = defineJob<{ id: string }>({
  queue: 'spec-on-demand',
  name: 'build',
  options: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 600 } },
  jobId: ({ id }) => `build-${id}`,
  describe: ({ id }) => `Build ${id}`,
  failurePrefix: 'spec: ',
});
const automatic = defineJob<{ id: string }>({
  queue: 'spec-on-demand',
  name: 'auto',
  options: {},
  describe: ({ id }) => `Automatic ${id}`,
});

describe('JobProducer against Redis', () => {
  let queue: Queue;
  let builds: JobProducer<{ id: string }>;
  let automatics: JobProducer<{ id: string }>;

  /** Fails every job of the queue with `reason`, then stops. */
  const failAll = async (reason: string) => {
    const worker = new Worker(
      build.queue,
      () => Promise.reject(new Error(reason)),
      { connection },
    );
    await waitUntil(async () => (await queue.getWaitingCount()) === 0);
    await waitUntil(async () => (await queue.getActiveCount()) === 0);
    await worker.close();
  };

  beforeAll(() => {
    queue = new Queue(build.queue, { connection });
    builds = new JobProducer(build, queue);
    automatics = new JobProducer(automatic, queue);
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('keeps one job per id, replacing only a failed one', async () => {
    await builds.addReplacingFailed({ id: 'a' });
    await builds.addReplacingFailed({ id: 'a' });
    expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
    await failAll('boom');
    await builds.addReplacingFailed({ id: 'a' });
    expect(await queue.getJobCounts('waiting', 'failed')).toMatchObject({
      waiting: 1,
      failed: 0,
    });
  });

  it('answers none, building, then failed with its window and its JobFailure message', async () => {
    const now = Date.now();
    expect(await onDemandState(builds, { id: 'b' })).toEqual({
      status: 'none',
    });
    await builds.add({ id: 'b' });
    expect(await onDemandState(builds, { id: 'b' })).toEqual({
      status: 'building',
    });
    await failAll('spec: too_large');
    expect(await onDemandState(builds, { id: 'b' }, now)).toMatchObject({
      status: 'failed',
      failure: 'too_large',
    });
    const { retryAfterSeconds } = (await onDemandState(
      builds,
      { id: 'b' },
      now + 590_000,
    )) as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(11);
  });

  it('reads a failure without the prefix as none of its own', async () => {
    await builds.add({ id: 'c' });
    await failAll('EACCES /data');
    expect(await onDemandState(builds, { id: 'c' })).toMatchObject({
      status: 'failed',
      failure: null,
    });
  });

  it('preempts only a delayed job of its own contract', async () => {
    await automatics.add({ id: 'd' }, { jobId: 'shared-d', delay: 60_000 });
    await builds.add({ id: 'e' }, { jobId: 'shared-e', delay: 60_000 });
    const auto = (await queue.getJob('shared-d'))!;
    const other = (await queue.getJob('shared-e'))!;
    expect(await automatics.preempt(other)).toBe(false);
    expect(await automatics.preempt(auto)).toBe(true);
    expect(await queue.getJob('shared-d')).toBeUndefined();
    await automatics.add({ id: 'f' }, { jobId: 'shared-f' });
    expect(await automatics.preempt((await queue.getJob('shared-f'))!)).toBe(
      false,
    );
  });
});
