import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { waitUntil } from '@libs/common/testing';
import { emptyProblemData, Judge, newId, TestGeneration } from '@libs/database';
import type { SourceCheck } from '@libs/database';
import { ProblemDataFilesService } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import { SourceCheckService } from '../src/jobs/source-check/source-check.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const PENDING: SourceCheck = {
  file: 'chk.cpp',
  status: 'pending',
  log: '',
  checkedAt: null,
};

describe('compile check of an uploaded checker', () => {
  let worker: WorkerTest;
  let service: SourceCheckService;
  let generations: Model<TestGeneration>;
  let judges: Model<Judge>;
  let problemId: string;

  const job = (file = 'chk.cpp'): SourceCheckJob => ({
    problemId,
    kind: 'customChecker',
    file,
  });
  const checkNow = async (): Promise<SourceCheck | null> => {
    const row = await worker.problems
      .findById(problemId, { sourceChecks: 1 })
      .lean();
    return row?.sourceChecks?.customChecker ?? null;
  };
  /** What the bridge and a judge do with the queued row. */
  const judgeAnswers = async (outcome: Partial<TestGeneration>) => {
    let id: unknown = null;
    await waitUntil(async () => {
      id =
        (await generations.findOne({ status: 'queued' }, { _id: 1 }).lean())
          ?._id ?? null;
      return id !== null;
    });
    const row = await generations.findById(id).lean();
    await generations.updateOne({ _id: id as never }, { $set: outcome });
    return row!;
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(SourceCheckService);
    generations = worker.module.get(getModelToken(TestGeneration.name));
    judges = worker.module.get(getModelToken(Judge.name));
  });
  afterAll(() => worker.teardown());

  beforeEach(async () => {
    await worker.problems.deleteMany({});
    await judges.deleteMany({});
    problemId = newId();
    await worker.problems.create({
      _id: problemId,
      code: 'chk',
      name: 'Checker',
      timeLimit: 1,
      memoryLimit: 1024,
      points: 800,
      groupId: newId(),
      data: {
        ...emptyProblemData(),
        checker: 'bridged',
        customChecker: 'chk.cpp',
      },
      sourceChecks: { customChecker: PENDING, customGrader: null },
    });
    await worker.module
      .get(ProblemDataFilesService)
      .writeFile('chk', 'chk.cpp', Buffer.from('#include "testlib.h"\n'));
  });

  const judgeOnline = (features: string[]) =>
    judges.create({
      name: 'local',
      authKeyHash: 'x',
      online: true,
      features,
    });

  it('records the compile log of a checker that does not compile', async () => {
    await judgeOnline(['generate.polygon', 'generate.compile']);
    const running = service.check(job());
    const row = await judgeAnswers({
      status: 'failed',
      failure: {
        stage: 'COMPILE',
        kind: 'COMPILE_ERROR',
        program: 'checker',
        testIndex: 0,
        detail: "chk.cpp:3: error: 'x' was not declared",
      },
    });
    await running;
    expect(row.feature).toBe('generate.compile');
    expect((row.plan as { tests: unknown[] }).tests).toEqual([]);
    expect(await checkNow()).toMatchObject({
      file: 'chk.cpp',
      status: 'error',
      log: "chk.cpp:3: error: 'x' was not declared",
    });
    expect(await generations.countDocuments()).toBe(0);
  });

  it('says no judge can check it when none online compiles checkers', async () => {
    await judgeOnline(['generate.polygon']);
    await service.check(job());
    expect(await checkNow()).toMatchObject({ status: 'unavailable' });
    expect(await generations.countDocuments()).toBe(0);
  });

  it('does nothing for a file that was replaced since the upload', async () => {
    await judgeOnline(['generate.compile']);
    await service.check(job('old.cpp'));
    expect(await checkNow()).toEqual(PENDING);
    expect(await generations.countDocuments()).toBe(0);
  });

  it('keeps a result away from a newer upload of the same kind', async () => {
    await judgeOnline(['generate.compile']);
    const running = service.check(job());
    await waitUntil(async () => (await generations.countDocuments()) === 1);
    // the teacher uploaded another checker while the judge compiled the first
    await worker.problems.updateOne(
      { _id: problemId },
      {
        $set: {
          'sourceChecks.customChecker': { ...PENDING, file: 'chk2.cpp' },
        },
      },
    );
    await judgeAnswers({ status: 'done', resultFileId: new Types.ObjectId() });
    await running;
    expect(await checkNow()).toMatchObject({
      file: 'chk2.cpp',
      status: 'pending',
    });
  });
});
