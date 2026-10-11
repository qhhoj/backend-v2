import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { JobType } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import {
  CONTEST_DATA_JOB,
  CONTEST_DATA_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  contestActionState,
  contestDataJobId,
  finalJudgeJobId,
  oneJobPerContest,
  notifyContestRescore,
  rescheduleFinalJudge,
} from './queues';
import type {
  ContestDataJob,
  ContestFinalJudgeJob,
  ContestRescoreJob,
  FinalJudgeTarget,
} from './queues';

describe('notifyContestRescore', () => {
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

describe('rescheduleFinalJudge', () => {
  let queue: Queue<ContestFinalJudgeJob>;
  const logger = new Logger('spec');
  const end = new Date(Date.now() + 3_600_000);
  const target = (extra: Partial<FinalJudgeTarget> = {}): FinalJudgeTarget => ({
    id: 'c9',
    endTime: end,
    formatName: 'final_submission',
    formatConfig: { autoJudge: true },
    ...extra,
  });
  const ids = async () =>
    (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);
  beforeAll(() => {
    queue = new Queue(CONTEST_FINAL_JUDGE_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('delays one job until the end and moves it with the end', async () => {
    await rescheduleFinalJudge(
      queue,
      { previous: null, next: target() },
      logger,
    );
    expect(await ids()).toEqual([finalJudgeJobId('c9', end)]);
    const later = new Date(end.getTime() + 60_000);
    await rescheduleFinalJudge(
      queue,
      { previous: target(), next: target({ endTime: later }) },
      logger,
    );
    expect(await ids()).toEqual([finalJudgeJobId('c9', later)]);
    expect(
      (await queue.getJob(finalJudgeJobId('c9', later)))!.opts.delay,
    ).toBeGreaterThan(3_600_000);
  });

  it('schedules nothing for other formats or without autoJudge, and drops the job when the contest stops judging at its end', async () => {
    await rescheduleFinalJudge(
      queue,
      {
        previous: null,
        next: target({ formatName: 'icpc', formatConfig: {} }),
      },
      logger,
    );
    await rescheduleFinalJudge(
      queue,
      { previous: null, next: target({ formatConfig: { autoJudge: false } }) },
      logger,
    );
    expect(await ids()).toEqual([]);
    await rescheduleFinalJudge(
      queue,
      { previous: null, next: target() },
      logger,
    );
    await rescheduleFinalJudge(
      queue,
      {
        previous: target(),
        next: target({ formatName: 'default', formatConfig: {} }),
      },
      logger,
    );
    expect(await ids()).toEqual([]);
  });
});

describe('contest extras queues', () => {
  let dataQueue: Queue<ContestDataJob>;
  beforeAll(() => {
    dataQueue = new Queue<ContestDataJob>(CONTEST_DATA_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
  });
  beforeEach(async () => {
    await dataQueue.obliterate({ force: true });
  });
  afterAll(async () => {
    await dataQueue.obliterate({ force: true });
    await dataQueue.close();
  });

  it('dedupes data jobs by contest id; one attempt, removed on completion and failure', async () => {
    const contestId = newId();
    const job = { contestId, problemGlob: '*', results: [] };
    await dataQueue.add(
      CONTEST_DATA_JOB,
      job,
      oneJobPerContest('data', contestId),
    );
    await dataQueue.add(
      CONTEST_DATA_JOB,
      job,
      oneJobPerContest('data', contestId),
    );
    expect(await dataQueue.getJobs(['waiting'])).toHaveLength(1);
    expect(
      (await dataQueue.getJob(contestDataJobId(contestId)))?.opts,
    ).toMatchObject({
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  });
});

interface StubJob {
  data: { contestId: string; manual?: boolean };
}

/** A queue whose live jobs are listed by type: only `getJobs` is used. */
const stubQueue = (jobsByType: Partial<Record<JobType, StubJob[]>>) =>
  ({
    getJobs: (types: JobType[]) =>
      Promise.resolve(types.flatMap((type) => jobsByType[type] ?? [])),
  }) as unknown as Queue<StubJob['data']>;

describe('contestActionState', () => {
  it('is running while the job is active, even with a waiting one behind it', async () => {
    const queue = stubQueue({
      active: [{ data: { contestId: 'contest-a' } }],
      waiting: [{ data: { contestId: 'contest-a' } }],
    });
    expect(await contestActionState(queue, 'contest-a')).toBe('running');
  });

  it.each<JobType>(['waiting', 'delayed'])(
    'is queued while a %s job waits',
    async (type) => {
      const queue = stubQueue({
        [type]: [{ data: { contestId: 'contest-a' } }],
      });
      expect(await contestActionState(queue, 'contest-a')).toBe('queued');
    },
  );

  it('ignores jobs of another contest', async () => {
    const queue = stubQueue({
      active: [{ data: { contestId: 'contest-b' } }],
      waiting: [{ data: { contestId: 'contest-b' } }],
    });
    expect(await contestActionState(queue, 'contest-a')).toBe('idle');
  });

  it('counts only the jobs the request filter accepts', async () => {
    const queue = stubQueue({
      delayed: [{ data: { contestId: 'contest-a', manual: false } }],
    });
    const isManual = (data: StubJob['data']) => data.manual === true;
    expect(await contestActionState(queue, 'contest-a', isManual)).toBe('idle');
    expect(await contestActionState(queue, 'contest-a')).toBe('queued');
  });
});
