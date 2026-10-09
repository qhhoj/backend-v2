import { once } from 'node:events';
import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { createTestApp, TEST_REDIS_URL } from '../testing';
import { REDIS, RedisModule } from './redis.module';

const KEY = 'redis-module-spec:written-on-close';

/** Writes through the shared client from a Fastify `onClose` hook, as the api's final activity flush does. */
@Injectable()
class WritesOnServerClose implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.adapterHost.httpAdapter
      .getInstance<FastifyInstance>()
      .addHook('onClose', async () => {
        await this.redis.set(KEY, 'flushed');
      });
  }
}

describe('RedisModule shutdown', () => {
  const observer = new Redis(TEST_REDIS_URL);
  beforeAll(() => {
    process.env.REDIS_URL = TEST_REDIS_URL;
  });
  afterAll(() => observer.quit());

  it('keeps the shared client open until the HTTP server has closed, then quits it', async () => {
    await observer.del(KEY);
    const app = await createTestApp({
      imports: [RedisModule],
      providers: [WritesOnServerClose],
    });
    const shared = app.get<Redis>(REDIS);
    // `quit()` resolves on the OK reply; the client turns `end` only when the socket closes after it
    const ended = once(shared, 'end');
    await app.close();
    expect(await observer.get(KEY)).toBe('flushed');
    await ended;
    expect(shared.status).toBe('end');
  });
});
