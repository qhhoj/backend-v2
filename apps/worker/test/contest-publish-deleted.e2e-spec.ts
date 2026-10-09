import { Queue } from 'bullmq';
import { ContestPublishService } from '../src/jobs/contest-publish/contest-publish.service';
import { softDeleteWorker } from './deleted-problem-fixtures';
import { seedContest, seedProblem, seedUser } from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const hours = (count: number) => new Date(Date.now() + count * 3_600_000);

describe('automatic publish with a deleted problem in the contest', () => {
  let worker: WorkerTest;
  let service: ContestPublishService;
  let queueAdd: jest.SpyInstance;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ContestPublishService);
    // The worker also consumes these queues: keep the jobs from running.
    queueAdd = jest
      .spyOn(Queue.prototype, 'add')
      .mockResolvedValue(undefined as never);
  });
  afterAll(async () => {
    queueAdd.mockRestore();
    await worker.teardown();
  });

  it('counts the deleted problem as skipped, leaves it alone and publishes the others', async () => {
    const editor = await seedUser(worker, {
      permissions: [
        'judge.edit_own_problem',
        'judge.change_public_visibility',
        'judge.edit_own_contest',
      ],
    });
    const live = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const gone = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    await softDeleteWorker(worker, gone._id);
    const contest = await seedContest(worker, {
      startTime: hours(-5),
      endTime: hours(-1),
      publishAfterEnd: true,
      publishAfterEndBy: editor._id,
      authors: [editor._id],
      problems: [live, gone].map((problem, order) => ({
        problem: problem._id,
        points: 100,
        order,
        partial: true,
        isPretested: false,
        outputPrefixOverride: null,
        maxSubmissions: null,
      })),
    });
    expect(await service.run(contest._id)).toBe('published');
    expect((await worker.problems.findById(live._id).lean())!.isPublic).toBe(
      true,
    );
    expect((await worker.problems.findById(gone._id).lean())!.isPublic).toBe(
      false,
    );
    expect(
      (await worker.contests.findById(contest._id).lean())!.autoPublishOutcome,
    ).toMatchObject({ status: 'published', published: 1, skipped: 1 });
  });
});
