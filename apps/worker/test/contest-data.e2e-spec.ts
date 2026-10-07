import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contestDataPath, contestDataTempPath, SPECTATE } from '@libs/contests';
import type { Contest, Language, Problem } from '@libs/database';
import { ContestDataRepository } from '../src/jobs/contest-data/contest-data.repository';
import { ContestDataService } from '../src/jobs/contest-data/contest-data.service';
import {
  CONTEST_DATA_LIMITS,
  ContestDataError,
  DEFAULT_CONTEST_DATA_LIMITS,
} from '../src/jobs/contest-data/data-zip';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { readZip } from './read-zip';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const VIRTUAL = 1;

describe('contest data zip', () => {
  const limits = { ...DEFAULT_CONTEST_DATA_LIMITS };
  let worker: WorkerTest;
  let service: ContestDataService;
  let repository: ContestDataRepository;
  let cpp: Language;
  let sum: Problem;
  let max: Problem;
  let contest: Contest;
  let aliceWrong: { _id: string };
  const contestProblem = (problem: Problem, order: number) => ({
    problem: problem._id,
    points: 100,
    partial: true,
    isPretested: false,
    order,
    outputPrefixOverride: null,
    maxSubmissions: null,
  });
  const userIds: Record<string, string> = {};
  const join_ = (username: string, virtual: number) =>
    seedParticipation(worker, contest._id, userIds[username], { virtual });
  const submit = async (
    participation: Awaited<ReturnType<typeof join_>>,
    problem: Problem,
    fields: { result: 'AC' | 'WA'; points: number },
    source: string,
  ) => {
    const submission = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      { language: cpp._id, ...fields },
      fields.points,
    );
    await worker.submissionSources.create({ _id: submission._id, source });
    return submission;
  };
  const zipPath = () => contestDataPath(worker.contestDataRoot, contest._id);

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [{ provide: CONTEST_DATA_LIMITS, useValue: limits }],
    });
    service = worker.module.get(ContestDataService);
    repository = worker.module.get(ContestDataRepository);
    cpp = await worker.languages.create({
      key: 'cpp',
      name: 'C++',
      commonName: 'C++',
      ace: 'text',
      pygments: 'text',
      extension: 'cpp',
    });
    for (const username of ['alice', 'bob', 'dave', 'carol'])
      userIds[username] = (await seedUser(worker, { username }))._id;
    sum = await seedProblem(worker, { code: 'sum' });
    max = await seedProblem(worker, { code: 'max' });
  });
  afterAll(() => worker.teardown());
  beforeEach(async () => {
    Object.assign(limits, DEFAULT_CONTEST_DATA_LIMITS);
    for (const name of readdirSync(worker.contestDataRoot))
      rmSync(join(worker.contestDataRoot, name), { recursive: true });
    contest = await seedContest(worker, {
      problems: [contestProblem(sum, 0), contestProblem(max, 1)],
    });
    const [alice, bob, dave, carol] = [
      await join_('alice', 0),
      await join_('bob', 0),
      await join_('dave', VIRTUAL),
      await join_('carol', SPECTATE),
    ];
    await submit(alice, sum, { result: 'AC', points: 100 }, 'int best() {}');
    aliceWrong = await submit(
      alice,
      sum,
      { result: 'WA', points: 40 },
      'int wa() {}',
    );
    await submit(bob, sum, { result: 'AC', points: 70 }, 'int bob() {}');
    await submit(alice, max, { result: 'AC', points: 100 }, 'int max() {}');
    await submit(dave, sum, { result: 'AC', points: 100 }, 'int virtual() {}');
    await submit(
      carol,
      sum,
      { result: 'AC', points: 100 },
      'int spectate() {}',
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('zips live submissions of matching problems and results, best first', async () => {
    const count = await service.prepare({
      contestId: contest._id,
      problemGlob: 's*',
      results: ['AC', 'WA'],
    });
    expect(count).toBe(3);
    expect(await readZip(zipPath())).toEqual({
      'alice/sum.cpp': 'int best() {}',
      [`alice/$History/sum_${aliceWrong._id}.cpp`]: 'int wa() {}',
      'bob/sum.cpp': 'int bob() {}',
    });
    expect(
      existsSync(contestDataTempPath(worker.contestDataRoot, contest._id)),
    ).toBe(false);
  });

  it('filters on the submission result and keeps every result when none is given', async () => {
    await service.prepare({
      contestId: contest._id,
      problemGlob: '*',
      results: ['WA'],
    });
    expect(Object.keys(await readZip(zipPath()))).toEqual(['alice/sum.cpp']);
    expect(await readZip(zipPath())).toEqual({
      'alice/sum.cpp': 'int wa() {}',
    });
    await service.prepare({
      contestId: contest._id,
      problemGlob: '*',
      results: [],
    });
    expect(Object.keys(await readZip(zipPath()))).toHaveLength(4);
  });

  it('replaces the previous zip', async () => {
    await service.prepare({
      contestId: contest._id,
      problemGlob: 'max',
      results: [],
    });
    await service.prepare({
      contestId: contest._id,
      problemGlob: 'sum',
      results: ['AC'],
    });
    expect(Object.keys(await readZip(zipPath())).sort()).toEqual([
      'alice/sum.cpp',
      'bob/sum.cpp',
    ]);
  });

  it('aborts at the byte cap and leaves no zip', async () => {
    writeFileSync(zipPath(), 'old');
    limits.maxBytes = 10;
    await expect(
      service.prepare({
        contestId: contest._id,
        problemGlob: '*',
        results: [],
      }),
    ).rejects.toThrow(ContestDataError);
    expect(readdirSync(worker.contestDataRoot)).toEqual([]);
  });

  it('refuses more entries than the cap before writing', async () => {
    limits.maxEntries = 1;
    await expect(
      service.prepare({
        contestId: contest._id,
        problemGlob: '*',
        results: [],
      }),
    ).rejects.toThrow(/narrow the filter/);
    expect(readdirSync(worker.contestDataRoot)).toEqual([]);
  });

  it('fetches sources in chunks of sourceChunk, one chunk at a time', async () => {
    limits.sourceChunk = 2;
    const fetched: number[] = [];
    const original = repository.sources.bind(repository);
    jest
      .spyOn(repository, 'sources')
      .mockImplementation(
        async (ids) => (fetched.push(ids.length), original(ids)),
      );
    await service.prepare({
      contestId: contest._id,
      problemGlob: '*',
      results: [],
    });
    expect(fetched).toEqual([2, 2]); // four entries
  });
});
