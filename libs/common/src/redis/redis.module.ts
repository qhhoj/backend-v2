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

  /** The last shutdown phase, not `onModuleDestroy`: the HTTP server closes after the destroy phase (Fastify `onClose` hooks such as the final activity flush still write), and BullMQ workers finish their running jobs in `onApplicationShutdown`. */
  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
