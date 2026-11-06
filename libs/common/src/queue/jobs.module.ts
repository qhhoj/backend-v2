import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Inject, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { JobContract } from './job-contract';
import { JobProducer } from './job-producer';

const producerToken = (contract: JobContract<never>): string =>
  `job-producer:${contract.queue}/${contract.name}`;

/** Every contract some class injects a producer of, for the contract spec. */
export const PRODUCED_JOBS = new Set<JobContract<never>>();

/** Injects the `JobProducer` of a contract registered by `JobsModule.register`. */
export const InjectJob = <Payload>(
  contract: JobContract<Payload>,
): ParameterDecorator => {
  PRODUCED_JOBS.add(contract);
  return Inject(producerToken(contract));
};

/** Registers the queues of the given contracts and provides their producers; a processor's module registers its own contract too. */
@Module({})
export class JobsModule {
  static register(...contracts: JobContract<never>[]): DynamicModule {
    const queues = BullModule.registerQueue(
      ...[...new Set(contracts.map(({ queue }) => queue))].map((name) => ({
        name,
      })),
    );
    const producers = contracts.map((contract) => ({
      provide: producerToken(contract),
      useFactory: (queue: Queue) => new JobProducer(contract, queue),
      inject: [getQueueToken(contract.queue)],
    }));
    return {
      module: JobsModule,
      imports: [queues],
      providers: producers,
      exports: [queues, ...producers.map(({ provide }) => provide)],
    };
  }
}
