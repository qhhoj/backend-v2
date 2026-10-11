import { Logger } from '@nestjs/common';
import type { JobType, Queue } from 'bullmq';
import {
  isReplayFinal,
  notifyReplayBuild,
  REPLAY_SETTLE_MS,
  replayDelayMs,
  requestReplayBuild,
} from './replay-queue';
import type { ContestReplayJob } from './replay-queue';

interface FakeJob {
  contestId: string;
  state: JobType;
  /** Milliseconds from now until a delayed job may run; 0 by default. */
  dueInMs?: number;
  /** The job started before it could be removed. */
  isLocked?: boolean;
}
const fakeQueue = (jobs: FakeJob[], fails = false) => {
  const add = jest.fn<Promise<void>, unknown[]>(() =>
    fails ? Promise.reject(new Error('redis down')) : Promise.resolve(),
  );
  const queue = {
    getJobs: (types: JobType[]) =>
      Promise.resolve(
        jobs
          .filter((job) => types.includes(job.state))
          .map((job) => ({
            data: { contestId: job.contestId },
            timestamp: Date.now() - 1000,
            delay: 1000 + (job.dueInMs ?? 0),
            remove: () => {
              if (job.isLocked)
                return Promise.reject(new Error('job is locked'));
              jobs.splice(jobs.indexOf(job), 1);
              return Promise.resolve();
            },
          })),
      ),
    add,
  } as unknown as Queue<ContestReplayJob>;
  return { queue, add };
};

describe('requestReplayBuild', () => {
  it('queues a build for an idle contest, to start at once by default', async () => {
    const { queue, add } = fakeQueue([]);
    expect(await requestReplayBuild(queue, 'c1')).toBe('queued');
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2]).toMatchObject({ delay: 0 });
  });

  it.each(['waiting', 'delayed'] as const)(
    'adds nothing while a %s build for the contest exists',
    async (state) => {
      const { queue, add } = fakeQueue([{ contestId: 'c1', state }]);
      expect(await requestReplayBuild(queue, 'c1')).toBe('coalesced');
      expect(add).not.toHaveBeenCalled();
    },
  );

  it('moves a build delayed past the requested time forward: the end moved earlier since it was queued', async () => {
    const jobs: FakeJob[] = [
      { contestId: 'c1', state: 'delayed', dueInMs: 3 * 3_600_000 },
    ];
    const { queue, add } = fakeQueue(jobs);
    expect(
      await requestReplayBuild(queue, 'c1', { delayMs: REPLAY_SETTLE_MS }),
    ).toBe('rescheduled');
    expect(jobs).toEqual([]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2]).toMatchObject({ delay: REPLAY_SETTLE_MS });
  });

  it('keeps a delayed build that is due no later than the requested time', async () => {
    const { queue, add } = fakeQueue([
      { contestId: 'c1', state: 'delayed', dueInMs: 60_000 },
    ]);
    expect(
      await requestReplayBuild(queue, 'c1', { delayMs: REPLAY_SETTLE_MS }),
    ).toBe('coalesced');
    expect(add).not.toHaveBeenCalled();
  });

  it('queues a build when the late delayed one started before it could be replaced', async () => {
    const { queue, add } = fakeQueue([
      {
        contestId: 'c1',
        state: 'delayed',
        dueInMs: 3_600_000,
        isLocked: true,
      },
    ]);
    expect(await requestReplayBuild(queue, 'c1')).toBe('queued');
    expect(add.mock.calls[0][2]).toMatchObject({ delay: 0 });
  });

  it('queues only one build behind a running one, however often it is asked', async () => {
    const jobs: FakeJob[] = [{ contestId: 'c1', state: 'active' }];
    const { queue, add } = fakeQueue(jobs);
    add.mockImplementation(() => {
      jobs.push({ contestId: 'c1', state: 'waiting' });
      return Promise.resolve();
    });
    for (let call = 0; call < 5; call += 1)
      await requestReplayBuild(queue, 'c1');
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('queues nothing while a build runs in skip mode', async () => {
    const { queue, add } = fakeQueue([{ contestId: 'c1', state: 'active' }]);
    await requestReplayBuild(queue, 'c1', { ifRunning: 'skip' });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('notifyReplayBuild', () => {
  it('reports true when a build is queued and false, without throwing, when the queue fails', async () => {
    const logger = new Logger('spec');
    const error = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    expect(await notifyReplayBuild(fakeQueue([]).queue, 'c1', logger)).toBe(
      true,
    );
    expect(
      await notifyReplayBuild(fakeQueue([], true).queue, 'c1', logger),
    ).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

const end = new Date('2026-01-01T15:00:00Z');

describe('replayDelayMs', () => {
  it('waits until the end plus the settle time, and not at all afterwards', () => {
    expect(replayDelayMs(end, new Date(end.getTime() - 60_000))).toBe(
      60_000 + REPLAY_SETTLE_MS,
    );
    expect(
      replayDelayMs(end, new Date(end.getTime() + REPLAY_SETTLE_MS - 1000)),
    ).toBe(1000);
    expect(
      replayDelayMs(end, new Date(end.getTime() + REPLAY_SETTLE_MS + 1)),
    ).toBe(0);
  });
});

describe('isReplayFinal', () => {
  it('accepts only a build made at or after the end plus the settle time', () => {
    const ready = end.getTime() + REPLAY_SETTLE_MS;
    expect(isReplayFinal(new Date(ready - 1), end)).toBe(false);
    expect(isReplayFinal(new Date(ready), end)).toBe(true);
    expect(isReplayFinal(new Date(end.getTime() - 3_600_000), end)).toBe(false);
  });
});
