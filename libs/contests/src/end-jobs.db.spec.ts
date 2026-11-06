import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JobProducer } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import {
  finalJudgeJobId,
  publishJobId,
  rescheduleFinalJudge,
  reschedulePublish,
} from './end-jobs';
import type { FinalJudgeTarget, PublishTarget } from './end-jobs';
import { contestJobs } from './jobs';
import type { ContestFinalJudgeJob, ContestPublishJob } from './jobs';

const end = new Date(Date.now() + 3_600_000);
const later = new Date(end.getTime() + 60_000);
const idsOf = async (queue: Queue) =>
  (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);

describe('rescheduleFinalJudge', () => {
  let queue: Queue;
  let finalJudges: JobProducer<ContestFinalJudgeJob>;
  const target = (extra: Partial<FinalJudgeTarget> = {}): FinalJudgeTarget => ({
    id: 'c9',
    endTime: end,
    formatName: 'final_submission',
    formatConfig: { autoJudge: true },
    ...extra,
  });
  beforeAll(() => {
    queue = new Queue(contestJobs.finalJudge.queue, {
      connection: { url: TEST_REDIS_URL },
    });
    finalJudges = new JobProducer(contestJobs.finalJudge, queue);
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('delays one job until the end and moves it with the end', async () => {
    await rescheduleFinalJudge(finalJudges, { previous: null, next: target() });
    expect(await idsOf(queue)).toEqual([finalJudgeJobId('c9', end)]);
    await rescheduleFinalJudge(finalJudges, {
      previous: target(),
      next: target({ endTime: later }),
    });
    expect(await idsOf(queue)).toEqual([finalJudgeJobId('c9', later)]);
    expect(
      (await queue.getJob(finalJudgeJobId('c9', later)))!.opts.delay,
    ).toBeGreaterThan(3_600_000);
  });

  it('schedules nothing for other formats or without autoJudge, and drops the job when the contest stops judging at its end', async () => {
    await rescheduleFinalJudge(finalJudges, {
      previous: null,
      next: target({ formatName: 'icpc', formatConfig: {} }),
    });
    await rescheduleFinalJudge(finalJudges, {
      previous: null,
      next: target({ formatConfig: { autoJudge: false } }),
    });
    expect(await idsOf(queue)).toEqual([]);
    await rescheduleFinalJudge(finalJudges, { previous: null, next: target() });
    await rescheduleFinalJudge(finalJudges, {
      previous: target(),
      next: target({ formatName: 'default', formatConfig: {} }),
    });
    expect(await idsOf(queue)).toEqual([]);
  });
});

describe('reschedulePublish', () => {
  let queue: Queue;
  let publishes: JobProducer<ContestPublishJob>;
  const target = (extra: Partial<PublishTarget> = {}): PublishTarget => ({
    id: 'c7',
    endTime: end,
    publishAfterEnd: true,
    ...extra,
  });
  beforeAll(() => {
    queue = new Queue(contestJobs.publish.queue, {
      connection: { url: TEST_REDIS_URL },
    });
    publishes = new JobProducer(contestJobs.publish, queue);
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('schedules nothing while the switch is off and drops the job when it goes off', async () => {
    await reschedulePublish(publishes, {
      previous: null,
      next: target({ publishAfterEnd: false }),
    });
    expect(await idsOf(queue)).toEqual([]);
    await reschedulePublish(publishes, { previous: null, next: target() });
    expect(await idsOf(queue)).toEqual([publishJobId('c7', end)]);
    await reschedulePublish(publishes, {
      previous: target(),
      next: target({ publishAfterEnd: false }),
    });
    expect(await idsOf(queue)).toEqual([]);
  });

  it('runs a contest that already ended at once', async () => {
    await reschedulePublish(publishes, {
      previous: null,
      next: target({ endTime: new Date(Date.now() - 1000) }),
    });
    const [job] = await queue.getJobs(['delayed', 'waiting']);
    expect(job.opts.delay ?? 0).toBe(0);
  });

  it('still adds the new job when removing the previous one fails', async () => {
    const failingRemove = Object.assign(Object.create(queue) as Queue, {
      remove: () => Promise.reject(new Error('redis down')),
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await reschedulePublish(
      new JobProducer(contestJobs.publish, failingRemove),
      { previous: target(), next: target({ endTime: later }) },
    );
    expect(await idsOf(queue)).toEqual([publishJobId('c7', later)]);
    jest.restoreAllMocks();
  });
});
