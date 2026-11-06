import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { defineJob } from './job-contract';
import { ENQUEUE_TIMEOUT_MS, JobProducer } from './job-producer';

describe('JobProducer', () => {
  const contract = defineJob<{ id: string }>({
    queue: 'spec-queue',
    name: 'spec',
    options: { attempts: 2 },
    jobId: ({ id }) => `spec-${id}`,
    describe: ({ id }) => `Spec job ${id}`,
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('adds the contract name, payload, options and job id; an explicit id wins', async () => {
    const add = jest.fn().mockResolvedValue({});
    const producer = new JobProducer(contract, { add } as unknown as Queue);
    await producer.enqueue({ id: 'a' });
    await producer.add({ id: 'b' }, { jobId: 'run-2' });
    expect(add.mock.calls).toEqual([
      ['spec', { id: 'a' }, { attempts: 2, jobId: 'spec-a' }],
      ['spec', { id: 'b' }, { attempts: 2, jobId: 'run-2' }],
    ]);
  });

  it('enqueue returns false within its bound and logs when Redis never answers', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const hanging = { add: () => new Promise(() => undefined) };
    const producer = new JobProducer(contract, hanging as unknown as Queue);
    jest.useFakeTimers();
    const pending = producer.enqueue({ id: 'a' });
    await jest.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);
    await expect(pending).resolves.toBe(false);
    expect(logged).toHaveBeenCalledWith(
      'Spec job a not enqueued: timed out after 1000 ms',
    );
  });

  it('add rethrows a refused add', async () => {
    const producer = new JobProducer(contract, {
      add: () => Promise.reject(new Error('down')),
    } as unknown as Queue);
    await expect(producer.add({ id: 'a' })).rejects.toThrow('down');
    await expect(producer.enqueue({ id: 'a' })).resolves.toBe(false);
  });
});
