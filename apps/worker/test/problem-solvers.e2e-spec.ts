import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { PROBLEM_SOLVERS_QUEUE } from '@libs/problems';
import type { ProblemSolversJob } from '@libs/problems';
import { ProblemSolversService } from '../src/jobs/problem-solvers/problem-solvers.service';
import { softDeleteWorker, undeleteWorker } from './deleted-problem-fixtures';
import { seedGraded, seedProblem, seedUser } from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('problem-solvers-recompute', () => {
  let worker: WorkerTest;
  let service: ProblemSolversService;
  const countOf = async (userId: string) =>
    (await worker.users.findById(userId, { problemCount: 1 }).lean())!
      .problemCount;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ProblemSolversService);
  });
  afterAll(() => worker.teardown());

  it('recomputes every user who submitted to the problem, and only them, in both directions', async () => {
    const solver = await seedUser(worker);
    const bystander = await seedUser(worker, { problemCount: 7 });
    const keep = await seedProblem(worker);
    const gone = await seedProblem(worker);
    await seedGraded(worker, solver._id, keep._id);
    await seedGraded(worker, solver._id, gone._id);
    await softDeleteWorker(worker, gone._id);
    expect(await service.recompute(gone._id)).toBe(1);
    expect(await countOf(solver._id)).toBe(1);
    expect(await countOf(bystander._id)).toBe(7);
    await undeleteWorker(worker, gone._id);
    expect(await service.recompute(gone._id)).toBe(1);
    expect(await countOf(solver._id)).toBe(2);
  });

  it('works through more users than one chunk', async () => {
    const problem = await seedProblem(worker);
    const users = await Promise.all(
      Array.from({ length: 12 }, () => seedUser(worker)),
    );
    for (const user of users) await seedGraded(worker, user._id, problem._id);
    expect(await service.recompute(problem._id)).toBe(12);
    expect(await countOf(users[11]._id)).toBe(1);
  });

  it('consumes the queue: a queued delete recomputes the solver', async () => {
    const queue = worker.module.get<Queue<ProblemSolversJob>>(
      getQueueToken(PROBLEM_SOLVERS_QUEUE),
    );
    const solver = await seedUser(worker);
    const problem = await seedProblem(worker);
    await seedGraded(worker, solver._id, problem._id);
    await service.recompute(problem._id);
    expect(await countOf(solver._id)).toBe(1);
    await softDeleteWorker(worker, problem._id);
    await queue.add('recompute', { problemId: problem._id, reason: 'deleted' });
    await waitUntil(async () => (await countOf(solver._id)) === 0);
    await undeleteWorker(worker, problem._id);
    await queue.add('recompute', {
      problemId: problem._id,
      reason: 'restored',
    });
    await waitUntil(async () => (await countOf(solver._id)) === 1);
  });
});
