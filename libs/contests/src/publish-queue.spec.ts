import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import {
  CONTEST_PUBLISH_QUEUE,
  publishJobId,
  reschedulePublish,
} from './publish-queue';
import type { ContestPublishJob, PublishTarget } from './publish-queue';

describe('reschedulePublish', () => {
  let queue: Queue<ContestPublishJob>;
  const logger = new Logger('spec');
  const end = new Date(Date.now() + 3_600_000);
  const target = (extra: Partial<PublishTarget> = {}): PublishTarget => ({
    id: 'c7',
    endTime: end,
    publishAfterEnd: true,
    ...extra,
  });
  const ids = async () =>
    (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);
  beforeAll(() => {
    queue = new Queue(CONTEST_PUBLISH_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('delays one job until the end and moves it with the end', async () => {
    await reschedulePublish(queue, { previous: null, next: target() }, logger);
    expect(await ids()).toEqual([publishJobId('c7', end)]);
    const later = new Date(end.getTime() + 60_000);
    await reschedulePublish(
      queue,
      { previous: target(), next: target({ endTime: later }) },
      logger,
    );
    expect(await ids()).toEqual([publishJobId('c7', later)]);
    expect(
      (await queue.getJob(publishJobId('c7', later)))!.opts.delay,
    ).toBeGreaterThan(3_600_000);
  });

  it('schedules nothing while the switch is off and drops the job when it goes off', async () => {
    await reschedulePublish(
      queue,
      { previous: null, next: target({ publishAfterEnd: false }) },
      logger,
    );
    expect(await ids()).toEqual([]);
    await reschedulePublish(queue, { previous: null, next: target() }, logger);
    await reschedulePublish(
      queue,
      { previous: target(), next: target({ publishAfterEnd: false }) },
      logger,
    );
    expect(await ids()).toEqual([]);
  });

  it('adds a job when the switch comes on and leaves an unchanged one alone', async () => {
    await reschedulePublish(
      queue,
      { previous: target({ publishAfterEnd: false }), next: target() },
      logger,
    );
    const [job] = await queue.getJobs(['delayed']);
    await reschedulePublish(
      queue,
      { previous: target(), next: target() },
      logger,
    );
    expect(
      (await queue.getJobs(['delayed'])).map((row) => row.timestamp),
    ).toEqual([job.timestamp]);
  });

  it('runs a contest that already ended at once, and logs instead of throwing when Redis does not answer', async () => {
    await reschedulePublish(
      queue,
      {
        previous: null,
        next: target({ endTime: new Date(Date.now() - 1000) }),
      },
      logger,
    );
    const [job] = await queue.getJobs(['delayed', 'waiting']);
    expect(job.opts.delay ?? 0).toBe(0);
    const hanging = {
      add: () => new Promise(() => undefined),
      remove: () => Promise.resolve(0),
    };
    await expect(
      reschedulePublish(
        hanging as unknown as Queue<ContestPublishJob>,
        { previous: null, next: target({ id: 'c8' }) },
        logger,
      ),
    ).resolves.toBeUndefined();
  });
});
