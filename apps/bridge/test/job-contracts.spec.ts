import { DECLARED_JOBS, JOB_PROCESSORS, PRODUCED_JOBS } from '@libs/common';
import type { JobContract } from '@libs/common';
// Loading the three apps' modules declares every contract, processor and producer injection (in the bridge's tests, which already load the api and the worker).
import '../../api/src/app.module';
import '../src/bridge.module';
import '../../worker/src/worker.module';

const label = (contract: JobContract<never>) =>
  `${contract.queue}/${contract.name}`;

describe('job contracts', () => {
  it('each declared job has exactly one processor', () => {
    expect(
      DECLARED_JOBS.filter((job) => JOB_PROCESSORS.get(job) !== 1).map(label),
    ).toEqual([]);
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

  it('no two contracts share a queue (one worker per queue)', () => {
    const queues = DECLARED_JOBS.map(({ queue }) => queue);
    expect(queues.filter((queue, at) => queues.indexOf(queue) !== at)).toEqual(
      [],
    );
  });
});
