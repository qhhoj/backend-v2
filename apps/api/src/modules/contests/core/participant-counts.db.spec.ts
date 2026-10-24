import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { recountParticipants } from './participant-counts';

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('recountParticipants', () => {
  const redis = new Redis(TEST_REDIS_URL);
  afterAll(() => redis.quit());

  it('stores the latest count when an earlier recount reads slower than a later one', async () => {
    let participants = 1;
    const stored: number[] = [];
    let reads = 0;
    const stores = {
      participations: {
        countsOf: async () => {
          const userCount = participants;
          // The first read is slow: the second join's recount reads and writes meanwhile.
          await sleep((reads += 1) === 1 ? 100 : 5);
          return { userCount, virtualCount: 0 };
        },
      },
      contests: {
        setCounts: (_contestId: string, counts: { userCount: number }) => {
          stored.push(counts.userCount);
          return Promise.resolve();
        },
      },
    };
    const contestId = `recount-spec-${Date.now()}`;
    const first = recountParticipants(redis, stores, contestId);
    await sleep(20);
    participants = 2;
    await recountParticipants(redis, stores, contestId);
    await first;
    expect(stored.at(-1)).toBe(2);
  });
});
