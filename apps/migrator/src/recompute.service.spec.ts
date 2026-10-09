import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { MIGRATION_RECOMPUTE_QUEUE, MIGRATION_REFUSAL } from '@libs/judging';
import { RecomputeService } from './recompute.service';

describe('RecomputeService', () => {
  const connection = { url: TEST_REDIS_URL };
  let worker: Worker | undefined;
  const listen = async (work: () => Promise<unknown>) => {
    worker = new Worker(MIGRATION_RECOMPUTE_QUEUE, work, { connection });
    await worker.waitUntilReady();
  };

  beforeEach(async () => {
    const redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();
    await redis.quit();
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  it('fails at once when no worker listens, instead of waiting forever', async () => {
    await expect(new RecomputeService().run(TEST_REDIS_URL)).rejects.toThrow(
      `no worker on ${MIGRATION_RECOMPUTE_QUEUE}`,
    );
  });

  it("returns the worker's result, and runs again after a finished run", async () => {
    const result = {
      participations: 1,
      ratedContests: 1,
      ratings: 2,
      frozenRatedContests: 0,
      problems: 2,
      users: 3,
      contributors: 3,
      organizations: 1,
      contests: 1,
    };
    await listen(() => Promise.resolve(result));
    await expect(new RecomputeService().run(TEST_REDIS_URL)).resolves.toEqual(
      result,
    );
    await expect(new RecomputeService().run(TEST_REDIS_URL)).resolves.toEqual(
      result,
    );
  });

  it('fails when the worker job fails', async () => {
    await listen(() => Promise.reject(new Error('boom')));
    await expect(new RecomputeService().run(TEST_REDIS_URL)).rejects.toThrow(
      'boom',
    );
  });

  it("reports the worker's refusal to run outside a migration clearly", async () => {
    await listen(() => Promise.reject(new Error(MIGRATION_REFUSAL)));
    await expect(new RecomputeService().run(TEST_REDIS_URL)).rejects.toThrow(
      'migration-recompute refused: the database has no migration marker',
    );
  });
});
