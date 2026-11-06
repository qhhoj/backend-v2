import { MODULE_METADATA } from '@nestjs/common/constants';
import { ContractProcessor, DECLARED_JOBS, PRODUCED_JOBS } from '@libs/common';
import type { ContractProcessorClass, JobContract } from '@libs/common';
// Loading the three apps' modules declares every contract and producer injection (in the bridge's tests, which already load the api and the worker).
import '../../api/src/app.module';
import '../src/bridge.module';
import { WorkerModule } from '../../worker/src/worker.module';

const label = (contract: JobContract<never>) =>
  `${contract.queue}/${contract.name}`;

type Provider = { useClass?: unknown } | (abstract new () => unknown);
type Imported = { module?: unknown; forwardRef?: () => unknown } | object;

/** Every provider class registered in a module graph: imported classes, dynamic modules and forward references, statically from their metadata. */
function providerClasses(root: unknown): Set<unknown> {
  const seen = new Set<unknown>();
  const classes = new Set<unknown>();
  const visit = (entry: unknown): void => {
    if (!entry || seen.has(entry)) return;
    seen.add(entry);
    const ref = entry as Imported & {
      imports?: unknown[];
      providers?: Provider[];
    };
    if ('forwardRef' in ref && ref.forwardRef) return visit(ref.forwardRef());
    const metadata = (key: string): unknown[] =>
      (typeof entry === 'function'
        ? (Reflect.getMetadata(key, entry) as unknown[] | undefined)
        : undefined) ?? [];
    const providers = [
      ...metadata(MODULE_METADATA.PROVIDERS),
      ...(ref.providers ?? []),
    ] as Provider[];
    for (const provider of providers)
      classes.add(
        typeof provider === 'function' ? provider : provider.useClass,
      );
    if ('module' in ref && ref.module) visit(ref.module);
    for (const imported of [
      ...metadata(MODULE_METADATA.IMPORTS),
      ...(ref.imports ?? []),
    ])
      visit(imported);
  };
  visit(root);
  return classes;
}

/** The processor classes the worker registers, and the contracts each consumes. */
const workerProcessors = [...providerClasses(WorkerModule)].filter(
  (provider): provider is ContractProcessorClass =>
    typeof provider === 'function' &&
    provider.prototype instanceof ContractProcessor,
);

describe('job contracts', () => {
  it('each declared job is consumed by exactly one processor the worker registers', () => {
    const consumers = (job: JobContract<never>) =>
      workerProcessors.filter(({ served }) => served.includes(job)).length;
    expect(
      DECLARED_JOBS.filter((job) => consumers(job) !== 1).map(label),
    ).toEqual([]);
  });

  it('each queue has one processor class (one worker per queue)', () => {
    const queues = workerProcessors.map(({ served }) => served[0].queue);
    expect(queues.filter((queue, at) => queues.indexOf(queue) !== at)).toEqual(
      [],
    );
  });

  it('each declared job is produced or scheduled, and each produced job is declared', () => {
    expect(
      DECLARED_JOBS.filter(
        (job) => !PRODUCED_JOBS.has(job) && !job.schedule,
      ).map(label),
    ).toEqual([]);
    expect(
      [...PRODUCED_JOBS]
        .filter((job) => !DECLARED_JOBS.includes(job))
        .map(label),
    ).toEqual([]);
  });
});
