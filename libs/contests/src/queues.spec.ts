import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import {
  CONTEST_RESCORE_JOB,
  CONTEST_RESCORE_QUEUE,
  notifyContestRescore,
} from './queues';
import type { ContestRescoreJob } from './queues';

describe('notifyContestRescore', () => {
  let queue: Queue<ContestRescoreJob>;
  beforeAll(() => {
    queue = new Queue(CONTEST_RESCORE_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('queues one retried job per call, even for the same contest', async () => {
    await notifyContestRescore(queue, 'c1', new Logger('spec'));
    await notifyContestRescore(queue, 'c1', new Logger('spec'));
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs.map((job) => [job.name, job.data])).toEqual([
      [CONTEST_RESCORE_JOB, { contestId: 'c1' }],
      [CONTEST_RESCORE_JOB, { contestId: 'c1' }],
    ]);
    expect(jobs.every((job) => job.opts.attempts === 3)).toBe(true);
  });

  it('logs instead of throwing when Redis does not answer', async () => {
    const hanging = {
      add: () => new Promise(() => undefined),
    } as unknown as Queue<ContestRescoreJob>;
    const logger = new Logger('spec');
    const logged = jest.spyOn(logger, 'error').mockImplementation();
    await expect(
      notifyContestRescore(hanging, 'c2', logger),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('c2'));
  });
});
