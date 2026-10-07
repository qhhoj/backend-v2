import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import {
  notifyOrganizationPoints,
  ORGANIZATION_POINTS_JOB,
  ORGANIZATION_POINTS_QUEUE,
} from './queues';
import type { OrganizationPointsJob } from './queues';

describe('notifyOrganizationPoints', () => {
  let queue: Queue<OrganizationPointsJob>;
  beforeAll(async () => {
    queue = new Queue(ORGANIZATION_POINTS_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    await queue.obliterate({ force: true });
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('queues one retried job per organization, duplicates included', async () => {
    const [first, second] = [newId(), newId()];
    await notifyOrganizationPoints(
      queue,
      [first, second, first],
      new Logger('spec'),
    );
    const jobs = await queue.getJobs(['waiting']);
    expect(
      jobs.map((job) => [job.name, job.data.organizationId]).sort(),
    ).toEqual(
      [
        [ORGANIZATION_POINTS_JOB, first],
        [ORGANIZATION_POINTS_JOB, first],
        [ORGANIZATION_POINTS_JOB, second],
      ].sort(),
    );
    expect(
      jobs.every(
        (job) => job.opts.attempts === 3 && job.opts.removeOnComplete === true,
      ),
    ).toBe(true);
  });

  it('does nothing for no organizations', async () => {
    await queue.obliterate({ force: true });
    await notifyOrganizationPoints(queue, [], new Logger('spec'));
    expect(await queue.getWaitingCount()).toBe(0);
  });

  it('logs instead of throwing when Redis does not answer', async () => {
    const hanging = {
      addBulk: () => new Promise(() => undefined),
    } as unknown as Queue<OrganizationPointsJob>;
    const logger = new Logger('spec');
    const logged = jest.spyOn(logger, 'error').mockImplementation();
    const organizationId = newId();
    await expect(
      notifyOrganizationPoints(hanging, [organizationId], logger),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(organizationId),
    );
  });
});
