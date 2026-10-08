import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppError } from '../errors/app.error';
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
  it('reads the count without adding a hit', async () => {
    expect(await limiter.count('peek')).toBe(0);
    await limiter.hit('peek', 60);
    expect(await limiter.count('peek')).toBe(1);
    expect(await limiter.count('peek')).toBe(1);
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
  it('reserves attempts and gives them back on release', async () => {
    const release = await limiter.reserve(['reserve:a', 'reserve:b'], 2, 60);
    expect(await redis.mget('rate:reserve:a', 'rate:reserve:b')).toEqual([
      '1',
      '1',
    ]);
    await release();
    expect(await redis.mget('rate:reserve:a', 'rate:reserve:b')).toEqual([
      '0',
      '0',
    ]);
  });
  it('rejects once any key is over the limit and keeps the hit', async () => {
    await limiter.reserve(['reserve:c'], 1, 60);
    await expect(
      limiter.reserve(['reserve:c', 'reserve:d'], 1, 60),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(await redis.get('rate:reserve:c')).toBe('2');
    expect(await redis.get('rate:reserve:d')).toBe('1');
  });
  it('tells a refused caller how long until the window ends', async () => {
    await limiter.reserve(['wait'], 1, 60);
    const refused = await limiter
      .reserve(['wait'], 1, 60)
      .catch((error: AppError) => error);
    expect(refused).toBeInstanceOf(AppError);
    const seconds = Number((refused as AppError).headers?.['Retry-After']);
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThanOrEqual(60);
  });
  it('waits for the longest window among the keys that are over the limit', async () => {
    await limiter.reserve(['busy'], 1, 60);
    await limiter.hit('fresh', 60);
    await limiter.release('fresh');
    await redis.expire('rate:busy', 10);
    await limiter.reserve(['quiet'], 1, 60);
    await redis.expire('rate:quiet', 50);
    const refused = await limiter
      .reserve(['busy', 'fresh', 'quiet'], 1, 60)
      .catch((error: AppError) => error);
    const seconds = Number((refused as AppError).headers?.['Retry-After']);
    expect(seconds).toBeGreaterThan(40);
    expect(seconds).toBeLessThanOrEqual(50);
  });
});
