import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { newId } from '@libs/database';
import { notifyAnnouncementFanout } from './notification-queues';
import type { NotificationFanoutJob } from './notification-queues';

describe('notifyAnnouncementFanout', () => {
  it('never throws when the queue is down: the announcement is already saved', async () => {
    const logger = new Logger('spec');
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
  });
});
