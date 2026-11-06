import type { JobType } from 'bullmq';
import type { JobProducer } from '@libs/common';
import { contestActionState } from './jobs';

interface StubData {
  contestId: string;
  manual?: boolean;
}

/** A producer whose live jobs are listed by type: only `jobs` is used. */
const stubJobs = (jobsByType: Partial<Record<JobType, StubData[]>>) =>
  ({
    jobs: (types: JobType[]) =>
      Promise.resolve(
        types.flatMap((type) =>
          (jobsByType[type] ?? []).map((data) => ({ data })),
        ),
      ),
  }) as unknown as JobProducer<StubData>;

describe('contestActionState', () => {
  it('is running while the job is active, even with a waiting one behind it', async () => {
    const jobs = stubJobs({
      active: [{ contestId: 'contest-a' }],
      waiting: [{ contestId: 'contest-a' }],
    });
    expect(await contestActionState(jobs, 'contest-a')).toBe('running');
  });

  it.each<JobType>(['waiting', 'delayed'])(
    'is queued while a %s job waits',
    async (type) => {
      const jobs = stubJobs({ [type]: [{ contestId: 'contest-a' }] });
      expect(await contestActionState(jobs, 'contest-a')).toBe('queued');
    },
  );

  it('ignores jobs of another contest', async () => {
    const jobs = stubJobs({
      active: [{ contestId: 'contest-b' }],
      waiting: [{ contestId: 'contest-b' }],
    });
    expect(await contestActionState(jobs, 'contest-a')).toBe('idle');
  });

  it('counts only the jobs the request filter accepts', async () => {
    const jobs = stubJobs({
      delayed: [{ contestId: 'contest-a', manual: false }],
    });
    const isManual = (data: StubData) => data.manual === true;
    expect(await contestActionState(jobs, 'contest-a', isManual)).toBe('idle');
    expect(await contestActionState(jobs, 'contest-a')).toBe('queued');
  });
});
