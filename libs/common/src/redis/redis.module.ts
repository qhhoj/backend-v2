import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../env/env';
import type { RedisConfig } from '../env/config-parts';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: ({ redisUrl }: RedisConfig) =>
        new Redis(redisUrl, { maxRetriesPerRequest: 3 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** The last shutdown phase (`JobWorkersDrain` declares the order): after the running jobs finished and the HTTP server closed, whose Fastify `onClose` hooks such as the final activity flush still write. */
  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
