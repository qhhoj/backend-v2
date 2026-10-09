import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: 3 }),
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
