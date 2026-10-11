import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import {
  clearOrganizationPointsPending,
  notifyDiscord,
  notifyOrganizationPoints,
  ORGANIZATION_POINTS_JOB,
  ORGANIZATION_POINTS_QUEUE,
} from './queues';
import type { DiscordWebhookJob, OrganizationPointsJob } from './queues';

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

  it('queues one job per distinct organization', async () => {
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

describe('notifyDiscord', () => {
  it('swallows a failing queue and logs the event', async () => {
    const error = jest.fn();
    const job = {
      event: 'on_new_comment' as const,
      message: { title: 'T', description: 'D', author: null },
    };
    await expect(
      notifyDiscord(
        {
          add: () => Promise.reject(new Error('redis down')),
        } as unknown as Queue<DiscordWebhookJob>,
        job,
        { error } as unknown as Logger,
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('on_new_comment'),
    );
  });
});
