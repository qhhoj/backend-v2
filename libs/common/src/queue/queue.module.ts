import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import type { RedisConfig } from '../env/config-parts';
import { ENV } from '../env/env';
import { JobWorkersDrain } from './job-workers-drain';

/** One BullMQ root per app on the existing Redis; feature modules add their queues with `JobsModule.register(...contracts)`. Plain `{ url }` options: BullMQ opens its own connections and sets `maxRetriesPerRequest: null` on the blocking ones itself, which the shared `REDIS` client (3 retries) would violate. Its workers finish their running jobs before the shared connections close (`JobWorkersDrain`). */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: ({ redisUrl }: RedisConfig) => ({
        connection: { url: redisUrl },
      }),
    }),
    DiscoveryModule,
  ],
  providers: [JobWorkersDrain],
  exports: [BullModule],
})
export class QueueModule {}
