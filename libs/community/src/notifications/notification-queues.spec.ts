import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import {
  NOTIFICATION_FANOUT_JOB,
  NOTIFICATION_FANOUT_QUEUE,
  notifyAnnouncementFanout,
} from './notification-queues';
import type { NotificationFanoutJob } from './notification-queues';

describe('notifyAnnouncementFanout', () => {
  let queue: Queue<NotificationFanoutJob>;
  const logger = new Logger('spec');
  beforeAll(() => {
    queue = new Queue(NOTIFICATION_FANOUT_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('queues one job carrying only the announcement id', async () => {
    const announcementId = newId();
    await notifyAnnouncementFanout(queue, announcementId, logger);
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs.map((job) => [job.name, job.data])).toEqual([
      [NOTIFICATION_FANOUT_JOB, { announcementId }],
    ]);
  });

  it('never throws when the queue is down: the announcement is already saved', async () => {
    const broken = {
      add: () => Promise.reject(new Error('redis down')),
    } as unknown as Queue<NotificationFanoutJob>;
    const error = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    await expect(
      notifyAnnouncementFanout(broken, newId(), logger),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('redis down'));
    error.mockRestore();
  });
});
