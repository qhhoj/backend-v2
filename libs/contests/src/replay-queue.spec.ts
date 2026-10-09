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
          .map((job) => ({ data: { contestId: job.contestId } })),
      ),
    add,
  } as unknown as Queue<ContestReplayJob>;
  return { queue, add };
};

describe('requestReplayBuild', () => {
  it('queues a build for an idle contest, to start at once by default', async () => {
    const { queue, add } = fakeQueue([]);
    await requestReplayBuild(queue, 'c1');
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2]).toMatchObject({ delay: 0 });
  });

  it('passes the delay on, so a build waits for the judge to settle', async () => {
    const { queue, add } = fakeQueue([]);
    await requestReplayBuild(queue, 'c1', { delayMs: 480_000 });
    expect(add.mock.calls[0][2]).toMatchObject({ delay: 480_000 });
  });

  it.each(['waiting', 'delayed'] as const)(
    'adds nothing while a %s build for the contest exists',
    async (state) => {
      const { queue, add } = fakeQueue([{ contestId: 'c1', state }]);
      await requestReplayBuild(queue, 'c1');
      expect(add).not.toHaveBeenCalled();
    },
  );

  it('queues another build while one is running by default, because the running one read older data', async () => {
    const { queue, add } = fakeQueue([{ contestId: 'c1', state: 'active' }]);
    await requestReplayBuild(queue, 'c1');
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('queues nothing for ten reader polls while a build runs, in skip mode', async () => {
    const { queue, add } = fakeQueue([{ contestId: 'c1', state: 'active' }]);
    for (let poll = 0; poll < 10; poll += 1)
      await requestReplayBuild(queue, 'c1', { ifRunning: 'skip' });
    expect(add).not.toHaveBeenCalled();
  });

  it('still queues in skip mode when nothing runs', async () => {
    const { queue, add } = fakeQueue([]);
    await requestReplayBuild(queue, 'c1', { ifRunning: 'skip' });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("is not held back by another contest's queued build", async () => {
    const { queue, add } = fakeQueue([{ contestId: 'c2', state: 'waiting' }]);
    await requestReplayBuild(queue, 'c1');
    expect(add).toHaveBeenCalledTimes(1);
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
