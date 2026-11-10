import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import type { RedisConfig } from '../env/config-parts';
import { ENV } from '../env/env';

/** One BullMQ root per app on the existing Redis; feature modules add their queues with `JobsModule.register(...contracts)`. Plain `{ url }` options: BullMQ opens its own connections and sets `maxRetriesPerRequest: null` on the blocking ones itself, which the shared `REDIS` client (3 retries) would violate. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: ({ redisUrl }: RedisConfig) => ({
        connection: { url: redisUrl },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
