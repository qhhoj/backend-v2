import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import {
  clearOrganizationPointsPending,
  notifyOrganizationPoints,
  ORGANIZATION_POINTS_JOB,
  ORGANIZATION_POINTS_QUEUE,
} from './queues';
import type { OrganizationPointsJob } from './queues';

describe('notifyOrganizationPoints', () => {
  let queue: Queue<OrganizationPointsJob>;
  let redis: Redis;
  const logger = new Logger('spec');
  const waiting = async () =>
    (await queue.getJobs(['waiting'])).map((job) => [
      job.name,
      job.data.organizationId,
    ]);
  beforeAll(() => {
    queue = new Queue(ORGANIZATION_POINTS_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    redis = new IORedis(TEST_REDIS_URL);
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await redis.flushdb();
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    redis.disconnect();
  });

  it('queues one retried job per distinct organization', async () => {
    const [first, second] = [newId(), newId()];
    await notifyOrganizationPoints(
      queue,
      redis,
      [first, second, first],
      logger,
    );
    expect((await waiting()).sort()).toEqual(
      [
        [ORGANIZATION_POINTS_JOB, first],
        [ORGANIZATION_POINTS_JOB, second],
      ].sort(),
    );
    const jobs = await queue.getJobs(['waiting']);
    expect(
      jobs.every(
        (job) => job.opts.attempts === 3 && job.opts.removeOnComplete === true,
      ),
    ).toBe(true);
  });

  it('queues no second job while one waits, and a new one once the recompute started', async () => {
    const organizationId = newId();
    await notifyOrganizationPoints(queue, redis, [organizationId], logger);
    await notifyOrganizationPoints(queue, redis, [organizationId], logger);
    expect(await waiting()).toHaveLength(1);
    await clearOrganizationPointsPending(redis, organizationId);
    await notifyOrganizationPoints(queue, redis, [organizationId], logger);
    expect(await waiting()).toHaveLength(2);
  });

  it('does nothing for no organizations', async () => {
    await notifyOrganizationPoints(queue, redis, [], logger);
    expect(await queue.getWaitingCount()).toBe(0);
  });

  it('logs instead of throwing when Redis does not answer', async () => {
    const hanging = {
      addBulk: () => new Promise(() => undefined),
    } as unknown as Queue<OrganizationPointsJob>;
    const logged = jest.spyOn(logger, 'error').mockImplementation();
    const organizationId = newId();
    await expect(
      notifyOrganizationPoints(hanging, redis, [organizationId], logger),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(organizationId),
    );
    expect(
      await redis.exists(`organization-points:pending:${organizationId}`),
    ).toBe(0);
  });
});
