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
  it('reports when any key reached the limit', async () => {
    for (let attempt = 0; attempt < 3; attempt++) await limiter.hit('busy', 60);
    expect(await limiter.exceeded(['quiet', 'busy'], 3)).toBe(true);
    expect(await limiter.exceeded(['quiet', 'busy'], 4)).toBe(false);
  });
  it('is not exceeded without keys', async () => {
    expect(await limiter.exceeded([], 1)).toBe(false);
  });
  it('rejects when redis reports an error', async () => {
    await redis.set('rate:typed', 'not-a-number');
    await expect(limiter.hit('typed', 60)).rejects.toThrow();
  });
});
