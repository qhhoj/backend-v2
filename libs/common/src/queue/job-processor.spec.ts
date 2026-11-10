import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { defineJob } from './job-contract';
import type { JobContract } from './job-contract';
import { JobProcessor } from './job-processor';

type Payload = { id: string };
const main = defineJob<Payload>({
  queue: 'spec-failed',
  name: 'run',
  options: {},
  describe: ({ id }) => `Main ${id}`,
});
const other = defineJob<Payload>({
  queue: 'spec-failed',
  name: 'other',
  options: {},
  describe: ({ id }) => `Other ${id}`,
});
const sweep = defineJob<void>({
  queue: 'spec-failed',
  name: 'sweep',
  options: {},
  describe: () => 'Spec sweep',
  schedule: { id: 'spec-sweep', every: 60_000 },
});

/** A processor of `main` (and `second`) whose `onFailure` records the payload ids it got. */
const processorOf = (second?: JobContract<void> | JobContract<Payload>) => {
  class Spec extends JobProcessor<Payload>(main, second) {
    readonly failures: string[] = [];
    run(): Promise<unknown> {
      return Promise.resolve();
    }
    sweep(): Promise<unknown> {
      return Promise.resolve();
    }
    protected onFailure({ id }: Payload): Promise<void> {
      this.failures.push(id);
      return Promise.resolve();
    }
  }
  return new Spec();
};

describe('JobProcessor failed()', () => {
  afterEach(() => jest.restoreAllMocks());

  // A stalled job can reach `failed` without a name; it is the main contract's on every queue.
  it.each([
    {
      queue: 'one contract',
      name: undefined,
      second: undefined,
      logged: 'Main a failed: stalled',
      failures: ['a'],
    },
    {
      queue: 'a second name',
      name: undefined,
      second: other,
      logged: 'Main a failed: stalled',
      failures: ['a'],
    },
    {
      queue: 'a second name',
      name: 'other',
      second: other,
      logged: 'Other a failed: stalled',
      failures: ['a'],
    },
    {
      queue: 'a sweep',
      name: undefined,
      second: sweep,
      logged: 'Main a failed: stalled',
      failures: ['a'],
    },
    {
      queue: 'a sweep',
      name: 'sweep',
      second: sweep,
      logged: 'Spec sweep failed: stalled',
      failures: [],
    },
  ])(
    'on a queue with $queue, a job named $name logs its own subject',
    async ({ name, second, logged, failures }) => {
      const errors = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const processor = processorOf(second);
      await processor.failed(
        { name, data: { id: 'a' } } as unknown as Job<Payload>,
        new Error('stalled'),
      );
      expect(errors).toHaveBeenCalledWith(logged);
      expect(processor.failures).toEqual(failures);
    },
  );
});

describe('JobProcessor start', () => {
  class Indexed {}
  const indexed = defineJob<Payload>({
    queue: 'spec-indexed',
    name: 'run',
    options: {},
    describe: ({ id }) => `Indexed ${id}`,
    needsIndexes: [Indexed],
  });
  class Spec extends JobProcessor<Payload>(indexed) {
    run(): Promise<unknown> {
      return Promise.resolve();
    }
  }

  // Nest awaits bootstrap hooks module after module: a slow index build must not hold back the queues after it.
  it('returns from bootstrap before the indexes exist, and consumes once they do', async () => {
    let indexesBuilt!: () => void;
    const init = jest.fn(
      () => new Promise<void>((resolve) => (indexesBuilt = resolve)),
    );
    const run = jest.fn();
    const processor = new Spec();
    Object.assign(processor, {
      moduleRef: {
        get: (token: string) => (token.includes('Indexed') ? { init } : {}),
      },
      _worker: { isRunning: () => false, run },
    });
    await processor.onApplicationBootstrap();
    expect(init).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    indexesBuilt();
    await new Promise((resolve) => setImmediate(resolve));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
