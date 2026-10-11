import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import {
  enqueuePurge,
  notifySolversRecompute,
  PROBLEM_PURGE_QUEUE,
  PROBLEM_SOLVERS_QUEUE,
  problemPurgeJobId,
} from './lifecycle-queues';
import type { ProblemPurgeJob, ProblemSolversJob } from './lifecycle-queues';

describe('problem lifecycle queues', () => {
  let solvers: Queue<ProblemSolversJob>;
  let purges: Queue<ProblemPurgeJob>;
  beforeAll(() => {
    const connection = { url: TEST_REDIS_URL };
    solvers = new Queue(PROBLEM_SOLVERS_QUEUE, { connection });
    purges = new Queue(PROBLEM_PURGE_QUEUE, { connection });
  });
  beforeEach(async () => {
    await solvers.obliterate({ force: true });
    await purges.obliterate({ force: true });
  });
  afterAll(async () => {
    await solvers.obliterate({ force: true });
    await purges.obliterate({ force: true });
    await solvers.close();
    await purges.close();
  });

  it('queues a retried recompute per call, so a delete and a restore both run', async () => {
    const logger = new Logger('spec');
    await notifySolversRecompute(
      solvers,
      { problemId: 'p1', reason: 'deleted' },
      logger,
    );
    await notifySolversRecompute(
      solvers,
      { problemId: 'p1', reason: 'restored' },
      logger,
    );
    const jobs = await solvers.getJobs(['waiting']);
    expect(jobs.map((job) => job.data.reason).sort()).toEqual([
      'deleted',
      'restored',
    ]);
    expect(jobs.every((job) => job.opts.attempts === 3)).toBe(true);
  });

  it('logs instead of throwing when Redis does not answer', async () => {
    const hanging = { add: () => new Promise(() => undefined) };
    const logger = new Logger('spec');
    const error = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    await notifySolversRecompute(
      hanging as unknown as Queue<ProblemSolversJob>,
      { problemId: 'p2', reason: 'deleted' },
      logger,
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('p2'));
  });

  it('removes a purge job that failed for good before queueing the problem again, and leaves a live one alone', async () => {
    const stub = (failed: boolean) => {
      const previous = {
        isFailed: () => Promise.resolve(failed),
        remove: jest.fn(),
      };
      const queue = { getJob: () => Promise.resolve(previous), add: jest.fn() };
      return {
        previous,
        queue: queue as unknown as Queue<ProblemPurgeJob>,
        add: queue.add,
      };
    };
    const dead = stub(true);
    await enqueuePurge(dead.queue, 'p5');
    expect(dead.previous.remove).toHaveBeenCalledTimes(1);
    expect(dead.add).toHaveBeenCalledTimes(1);
    const running = stub(false);
    await enqueuePurge(running.queue, 'p5');
    expect(running.previous.remove).not.toHaveBeenCalled();
  });

  it('keeps one purge job per problem', async () => {
    await enqueuePurge(purges, 'p3');
    await enqueuePurge(purges, 'p3');
    await enqueuePurge(purges, 'p4');
    expect(
      (await purges.getJobs(['waiting'])).map((job) => job.id).sort(),
    ).toEqual([problemPurgeJobId('p3'), problemPurgeJobId('p4')].sort());
  });
});
