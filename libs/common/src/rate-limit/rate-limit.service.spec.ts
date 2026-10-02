import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { REDIS, RedisModule } from '../redis/redis.module';
import { TEST_REDIS_URL } from '../testing';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  let testingModule: TestingModule;
  let limiter: RateLimitService;
  let redis: Redis;

  beforeAll(async () => {
    process.env.REDIS_URL = TEST_REDIS_URL;
    testingModule = await Test.createTestingModule({
      imports: [RedisModule],
      providers: [RateLimitService],
    }).compile();
    limiter = testingModule.get(RateLimitService);
    redis = testingModule.get(REDIS);
  });
  beforeEach(() => redis.flushdb());
  afterAll(() => testingModule.close());

  it('counts hits inside one window', async () => {
    expect(await limiter.hit('login:ip:1', 60)).toBe(1);
    expect(await limiter.hit('login:ip:1', 60)).toBe(2);
    expect(await redis.ttl('rate:login:ip:1')).toBeGreaterThan(55);
  });
  it('does not extend the window on later hits', async () => {
    await limiter.hit('slide', 60);
    await redis.expire('rate:slide', 5);
    await limiter.hit('slide', 60);
    expect(await redis.ttl('rate:slide')).toBeLessThanOrEqual(5);
  });
  it('rejects when redis reports an error', async () => {
    await redis.set('rate:typed', 'not-a-number');
    await expect(limiter.hit('typed', 60)).rejects.toThrow();
  });
  it('releases a hit but never below zero', async () => {
    await limiter.hit('giveback', 60);
    await limiter.release('giveback');
    await limiter.release('giveback');
    expect(await limiter.hit('giveback', 60)).toBe(1);
  });
});
