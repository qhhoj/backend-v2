import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { QueueEvents, Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import { EnvModule, QueueModule } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';

const QUEUE_NAME = 'worker-e2e-queue';

@Module({
  imports: [
    EnvModule.forValues({ redisUrl: TEST_ENV.REDIS_URL }),
    QueueModule,
    BullModule.registerQueue({ name: QUEUE_NAME }),
  ],
})
class QueueProbeModule {}

describe('WorkerModule', () => {
  it('a queue registered on the QueueModule root delivers jobs to a worker', async () => {
    const probe = await Test.createTestingModule({
      imports: [QueueProbeModule],
    }).compile();
    await probe.init();
    const queue = probe.get<Queue>(getQueueToken(QUEUE_NAME));
    const connection = { url: TEST_ENV.REDIS_URL };
    const events = new QueueEvents(QUEUE_NAME, { connection });
    const processor = new Worker<{ value: number }, number>(
      QUEUE_NAME,
      (job) => Promise.resolve(job.data.value * 2),
      { connection },
    );
    try {
      await events.waitUntilReady();
      const job = await queue.add('double', { value: 21 });
      await expect(job.waitUntilFinished(events)).resolves.toBe(42);
    } finally {
      await processor.close();
      await events.close();
      await queue.obliterate({ force: true });
      await probe.close();
    }
  });
});
