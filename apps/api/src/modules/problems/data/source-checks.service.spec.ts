import { emptyProblemData } from '@libs/database';
import type { ProblemData, SourceCheck } from '@libs/database';
import type { SourceCheckJob } from '@libs/problems';
import type { Queue } from 'bullmq';
import type { ProblemsRepository } from '../core/problems.repository';
import { SourceChecksService } from './source-checks.service';

/** Records what the service stored and queued for one problem. */
function serviceWithLog() {
  const stored: [string, SourceCheck | null][] = [];
  const queued: SourceCheckJob[] = [];
  const repository = {
    setSourceCheck: (_id: string, kind: string, check: SourceCheck | null) => {
      stored.push([kind, check]);
      return Promise.resolve();
    },
  } as unknown as ProblemsRepository;
  const queue = {
    add: (_name: string, job: SourceCheckJob) => {
      queued.push(job);
      return Promise.resolve();
    },
  } as unknown as Queue<SourceCheckJob>;
  return {
    service: new SourceChecksService(repository, queue),
    stored,
    queued,
  };
}

const data = (overrides: Partial<ProblemData>): ProblemData => ({
  ...emptyProblemData(),
  ...overrides,
});

describe('SourceChecksService.afterFileChange', () => {
  it('re-checks the uploaded checker when the header it compiles beside changes', async () => {
    const { service, stored, queued } = serviceWithLog();
    await service.afterFileChange(
      'p1',
      'customHeader',
      data({ customChecker: 'chk.cpp', customHeader: 'graph.h' }),
    );
    expect(queued).toEqual([
      { problemId: 'p1', kind: 'customChecker', file: 'chk.cpp' },
    ]);
    expect(stored).toEqual([
      [
        'customChecker',
        { file: 'chk.cpp', status: 'pending', log: '', checkedAt: null },
      ],
    ]);
  });

  it('queues nothing for a header change when there is no checker', async () => {
    const { service, queued } = serviceWithLog();
    await service.afterFileChange(
      'p1',
      'customHeader',
      data({ customHeader: 'graph.h' }),
    );
    expect(queued).toEqual([]);
  });

  it('never checks a generator or an archive', async () => {
    const { service, stored, queued } = serviceWithLog();
    const withChecker = data({ customChecker: 'chk.cpp' });
    await service.afterFileChange('p1', 'generator', withChecker);
    await service.afterFileChange('p1', 'archive', withChecker);
    expect([stored, queued]).toEqual([[], []]);
  });
});
