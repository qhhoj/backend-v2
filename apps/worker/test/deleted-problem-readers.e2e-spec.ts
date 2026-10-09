import { gradedJobOf } from '@libs/judging';
import type { PolygonImportJob } from '@libs/problems';
import { ContestDataRepository } from '../src/jobs/contest-data/contest-data.repository';
import { ContributionPointsRepository } from '../src/jobs/contribution-points/contribution-points.repository';
import { PdfRenderRepository } from '../src/jobs/pdf-render/pdf-render.repository';
import { PolygonImportRepository } from '../src/jobs/polygon-import/polygon-import.repository';
import { ContestResultsRepository } from '../src/jobs/submission-effects/contest-results.repository';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import { softDeleteWorker, undeleteWorker } from './deleted-problem-fixtures';
import {
  seedContest,
  seedGraded,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('deleted problems in the worker readers', () => {
  let worker: WorkerTest;
  let effects: SubmissionEffectsService;
  const pointsOf = async (userId: string) =>
    (await worker.users
      .findById(userId, { performancePoints: 1, problemCount: 1 })
      .lean())!;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    effects = worker.module.get(SubmissionEffectsService);
  });
  afterAll(() => worker.teardown());

  it("takes a deleted problem out of a user's points and puts it back exactly on restore", async () => {
    const user = await seedUser(worker);
    const keep = await seedProblem(worker, { points: 1000 });
    const drop = await seedProblem(worker, { points: 1000 });
    await seedGraded(worker, user._id, keep._id);
    await seedGraded(worker, user._id, drop._id);
    await effects.recomputeUser(user._id);
    const before = await pointsOf(user._id);
    expect(before.problemCount).toBe(2);
    await softDeleteWorker(worker, drop._id);
    await effects.recomputeUser(user._id);
    const during = await pointsOf(user._id);
    expect(during.problemCount).toBe(1);
    expect(during.performancePoints).toBeLessThan(before.performancePoints);
    await undeleteWorker(worker, drop._id);
    await effects.recomputeUser(user._id);
    expect(await pointsOf(user._id)).toEqual(before);
  });

  it('ignores a submission that finishes grading while its problem is deleted', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker);
    await softDeleteWorker(worker, problem._id);
    const submission = await seedGraded(worker, user._id, problem._id);
    await effects.apply(
      gradedJobOf((await worker.submissions.findById(submission._id).lean())!),
    );
    expect(await pointsOf(user._id)).toMatchObject({
      problemCount: 0,
      performancePoints: 0,
    });
    expect(
      (await worker.problems.findById(problem._id).lean())!.userCount,
    ).toBe(0);
  });

  it('does not count a deleted suggested problem as a public suggestion', async () => {
    const suggester = await seedUser(worker);
    await seedProblem(worker, { suggester: suggester._id });
    const dropped = await seedProblem(worker, { suggester: suggester._id });
    const repository = worker.module.get(ContributionPointsRepository);
    expect((await repository.totals(suggester._id)).publicSuggestions).toBe(2);
    await softDeleteWorker(worker, dropped._id);
    expect((await repository.totals(suggester._id)).publicSuggestions).toBe(1);
  });

  it('finds no deleted problem for the PDF job, the contest data zip and contest scoring', async () => {
    const problem = await seedProblem(worker, { partial: true });
    const contest = await seedContest(worker, {
      problems: [
        {
          problem: problem._id,
          points: 100,
          order: 0,
          partial: true,
          isPretested: false,
          outputPrefixOverride: null,
          maxSubmissions: null,
        },
      ],
    });
    const pdf = worker.module.get(PdfRenderRepository);
    const data = worker.module.get(ContestDataRepository);
    const results = worker.module.get(ContestResultsRepository);
    expect((await pdf.findByCode(problem.code))?.code).toBe(problem.code);
    expect((await data.findContest(contest._id))!.problems[0].code).toBe(
      problem.code,
    );
    expect((await results.problemPartials([problem._id])).size).toBe(1);
    await softDeleteWorker(worker, problem._id);
    expect(await pdf.findByCode(problem.code)).toBeNull();
    expect((await data.findContest(contest._id))!.problems[0].code).toBe('');
    expect((await results.problemPartials([problem._id])).size).toBe(0);
  });

  it('refuses a Polygon import into the code of a deleted problem, whatever the mode', async () => {
    const problem = await seedProblem(worker);
    await softDeleteWorker(worker, problem._id);
    const repository = worker.module.get(PolygonImportRepository);
    for (const mode of ['create', 'update'] as const)
      await expect(
        repository.resolveTarget({
          code: problem.code,
          mode,
        } as PolygonImportJob),
      ).rejects.toThrow(/is deleted/);
  });
});
