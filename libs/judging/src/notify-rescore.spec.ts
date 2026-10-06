import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { newId } from '@libs/database';
import { notifyRescore, RESCORE_ENQUEUE_TIMEOUT_MS } from './notify-rescore';
import { enqueueRescore } from './queues';
import type { ProblemRescoreJob } from './queues';

describe('notifyRescore', () => {
  const logger = new Logger('NotifyRescoreSpec');
  afterEach(() => jest.restoreAllMocks());

  it('adds one rescore job for the problem', async () => {
    const add = jest.fn().mockResolvedValue({});
    const problemId = newId();
    await notifyRescore(
      { add } as unknown as Queue<ProblemRescoreJob>,
      problemId,
      logger,
    );
    expect(add).toHaveBeenCalledWith(
      'rescore',
      { problemId },
      expect.objectContaining({ removeOnComplete: true }),
    );
  });

  it('keeps both jobs when the problem is edited again while its rescore is pending or active', async () => {
    // BullMQ ignores an `add` whose jobId already exists (pending or active).
    const kept: unknown[] = [];
    const seenJobIds = new Set<string>();
    const queue = {
      add: (_name: string, data: unknown, options: { jobId?: string }) => {
        if (options.jobId === undefined || !seenJobIds.has(options.jobId))
          kept.push(data);
        if (options.jobId !== undefined) seenJobIds.add(options.jobId);
        return Promise.resolve({});
      },
    } as unknown as Queue<ProblemRescoreJob>;
    const problemId = newId();
    await enqueueRescore(queue, problemId);
    await enqueueRescore(queue, problemId);
    expect(kept).toEqual([{ problemId }, { problemId }]);
  });

  it('retries a failed rescore with exponential backoff', async () => {
    const add = jest.fn<Promise<object>, unknown[]>().mockResolvedValue({});
    await enqueueRescore(
      { add } as unknown as Queue<ProblemRescoreJob>,
      newId(),
    );
    expect(add.mock.calls[0][2]).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  });

  it('returns within its bound and logs when Redis never answers', async () => {
    const logged = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const hanging = { add: () => new Promise(() => undefined) };
    const started = Date.now();
    await expect(
      notifyRescore(
        hanging as unknown as Queue<ProblemRescoreJob>,
        newId(),
        logger,
      ),
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(RESCORE_ENQUEUE_TIMEOUT_MS + 500);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('never throws when the queue rejects', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const failing = { add: () => Promise.reject(new Error('down')) };
    await expect(
      notifyRescore(
        failing as unknown as Queue<ProblemRescoreJob>,
        newId(),
        logger,
      ),
    ).resolves.toBeUndefined();
  });
});
