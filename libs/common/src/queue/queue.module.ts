import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../env/env';
import type { Env } from '../env/env';

/** One BullMQ root per app on the existing Redis; feature modules add `BullModule.registerQueue({ name })`. Plain `{ url }` options: BullMQ opens its own connections and sets `maxRetriesPerRequest: null` on the blocking ones itself, which the shared `REDIS` client (3 retries) would violate. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ connection: { url: env.redisUrl } }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
