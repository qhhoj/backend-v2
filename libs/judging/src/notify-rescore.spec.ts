import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { newId } from '@libs/database';
import { notifyRescore, RESCORE_ENQUEUE_TIMEOUT_MS } from './notify-rescore';
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
