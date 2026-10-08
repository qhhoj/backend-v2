import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import {
  CONTEST_DATA_JOB,
  CONTEST_DATA_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_RESCORE_JOB,
  CONTEST_RESCORE_QUEUE,
  contestDataJobId,
  enqueueContestRating,
  finalJudgeJobId,
  oneJobPerContest,
  notifyContestRescore,
  rescheduleFinalJudge,
} from './queues';
import type {
  ContestDataJob,
  ContestFinalJudgeJob,
  ContestRatingJob,
  ContestRescoreJob,
  FinalJudgeTarget,
} from './queues';

describe('notifyContestRescore', () => {
  let queue: Queue<ContestRescoreJob>;
  beforeAll(async () => {
    queue = new Queue(CONTEST_RESCORE_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    await queue.obliterate({ force: true });
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
    expect(jobs[0].opts).toMatchObject({
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
    });
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
  let ratingQueue: Queue<ContestRatingJob>;
  beforeAll(() => {
    dataQueue = new Queue<ContestDataJob>(CONTEST_DATA_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    ratingQueue = new Queue(CONTEST_RATING_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
  });
  beforeEach(async () => {
    await dataQueue.obliterate({ force: true });
    await ratingQueue.obliterate({ force: true });
  });
  afterAll(async () => {
    await dataQueue.obliterate({ force: true });
    await ratingQueue.obliterate({ force: true });
    await dataQueue.close();
    await ratingQueue.close();
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

  it('queues a rating per request, retried', async () => {
    const contestId = newId();
    await enqueueContestRating(ratingQueue, contestId);
    await enqueueContestRating(ratingQueue, contestId);
    const jobs = await ratingQueue.getJobs(['waiting']);
    expect(jobs.map((job) => [job.data, job.opts.attempts])).toEqual([
      [{ contestId }, 3],
      [{ contestId }, 3],
    ]);
  });
});
