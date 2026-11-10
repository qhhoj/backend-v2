import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ENQUEUE_TIMEOUT_MS, JobProducer } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import {
  clearOrganizationPointsPending,
  communityJobs,
  notifyOrganizationPoints,
} from './jobs';
import type { OrganizationPointsJob } from './jobs';

describe('notifyOrganizationPoints', () => {
  const contract = communityJobs.organizationPoints;
  let queue: Queue<OrganizationPointsJob>;
  let jobs: JobProducer<OrganizationPointsJob>;
  let redis: Redis;
  const waiting = async () =>
    (await queue.getJobs(['waiting'])).map((job) => job.data.organizationId);
  beforeAll(() => {
    queue = new Queue(contract.queue, { connection: { url: TEST_REDIS_URL } });
    jobs = new JobProducer(contract, queue);
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
    await notifyOrganizationPoints(jobs, redis, [first, second, first]);
    expect((await waiting()).sort()).toEqual([first, second].sort());
  });

  it('queues no second job while one waits, and a new one once the recompute started', async () => {
    const organizationId = newId();
    await notifyOrganizationPoints(jobs, redis, [organizationId]);
    await notifyOrganizationPoints(jobs, redis, [organizationId]);
    expect(await waiting()).toHaveLength(1);
    await clearOrganizationPointsPending(redis, organizationId);
    await notifyOrganizationPoints(jobs, redis, [organizationId]);
    expect(await waiting()).toHaveLength(2);
  });

  it('logs instead of throwing when Redis does not answer, and drops its flag', async () => {
    const hanging = new JobProducer(contract, {
      addBulk: () => new Promise(() => undefined),
    } as unknown as Queue);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const organizationId = newId();
    await expect(
      notifyOrganizationPoints(hanging, redis, [organizationId]),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(organizationId),
    );
    expect(
      await redis.exists(`organization-points:pending:${organizationId}`),
    ).toBe(0);
    logged.mockRestore();
  });
  it('drops a flag set after the 1 s bound when its add then fails', async () => {
    const failing = new JobProducer(contract, {
      addBulk: () => Promise.reject(new Error('redis down')),
    } as unknown as Queue);
    const slowRedis = {
      set: async (...args: Parameters<Redis['set']>) => {
        await new Promise((resolve) =>
          setTimeout(resolve, ENQUEUE_TIMEOUT_MS + 300),
        );
        return redis.set(...args);
      },
      del: (key: string) => redis.del(key),
    } as unknown as Redis;
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const organizationId = newId();
    await notifyOrganizationPoints(failing, slowRedis, [organizationId]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(
      await redis.exists(`organization-points:pending:${organizationId}`),
    ).toBe(0);
    logged.mockRestore();
  });
});
