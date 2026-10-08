import { SPECTATE } from '@libs/contests';
import { newId, uuidStr } from '@libs/database';
import type {
  Contest,
  Language,
  Problem,
  SimilarityRun,
  Submission,
} from '@libs/database';
import {
  DEFAULT_MAX_FRAGMENTS_PER_PAIR,
  SimilarityEngine,
  SimilarityEngineError,
} from '../src/jobs/similarity/similarity-engine';
import type {
  EnginePair,
  EngineRequest,
  EngineSubmission,
} from '../src/jobs/similarity/similarity-engine';
import { SimilarityService } from '../src/jobs/similarity/similarity.service';
import {
  seedContest,
  seedContestSubmission,
  seedGraded,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { KNAPSACK, SIEVE, SIEVE_RENAMED } from './similarity-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

jest.setTimeout(120_000);

/** A made-up engine result, for tests about what the service does with pairs rather than how they are found. */
const fakePair = (
  left: EngineSubmission,
  right: EngineSubmission,
  similarity: number,
): EnginePair => ({
  leftId: left.id,
  rightId: right.id,
  similarity,
  longest: 10,
  overlap: 20,
  fragments: [{ leftStart: 1, leftEnd: 2, rightStart: 1, rightEnd: 2 }],
});

describe('similarity run', () => {
  let worker: WorkerTest;
  let service: SimilarityService;
  let engine: SimilarityEngine;
  let cpp: Language;
  let plainC: Language;
  let kotlin: Language;
  let python: Language;
  let problem: Problem;

  const limits = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };
  const language = (key: string, commonName: string, extension: string) =>
    worker.languages.create({
      key,
      name: key,
      commonName,
      ace: 'text',
      pygments: 'text',
      extension,
    });
  /** A graded C++ submission with its source, AC unless `fields` say otherwise; later calls are newer. */
  const submit = async (
    userId: string,
    source: string,
    fields: Partial<Submission> = {},
  ) => {
    const submission = await seedGraded(worker, userId, problem._id, {
      language: cpp._id,
      ...fields,
    });
    await worker.submissionSources.create({ _id: submission._id, source });
    return submission;
  };
  const newUser = async () => (await seedUser(worker))._id;
  const newUsers = (count: number) =>
    Promise.all(Array.from({ length: count }, newUser));
  const startRun = (fields: Partial<SimilarityRun> = {}) =>
    worker.similarityRuns.create({
      scope: 'problem',
      scopeKey: `problem:${problem._id}`,
      problem: problem._id,
      requestedBy: newId(),
      limits,
      ...fields,
    });
  const loadRun = async (runId: string) => ({
    run: (await worker.similarityRuns.findById(runId).lean())!,
    pairs: await worker.similarityPairs
      .find({ run: runId })
      .sort({ similarity: -1 })
      .lean(),
  });
  const runAndLoad = async (fields: Partial<SimilarityRun> = {}) => {
    const run = await startRun(fields);
    await service.run(run._id);
    const loaded = await loadRun(run._id);
    // Whatever happened, a run that `run()` returned from never keeps its scope blocked.
    expect(loaded.run.active).toBe(false);
    return loaded;
  };
  const idsOf = (pair: {
    left: { submission: unknown };
    right: { submission: unknown };
  }) => [uuidStr(pair.left.submission), uuidStr(pair.right.submission)].sort();
  /** Replaces the engine with `answer`, per request. */
  const fakeEngine = (
    answer: (request: EngineRequest) => EnginePair[] | Promise<EnginePair[]>,
  ) =>
    jest
      .spyOn(engine, 'compare')
      // Through `then`, so a throwing answer rejects like the real engine.
      .mockImplementation((request) =>
        Promise.resolve().then(() => answer(request)),
      );

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(SimilarityService);
    engine = worker.module.get(SimilarityEngine);
    cpp = await language('CPP17', 'C++', 'cpp');
    plainC = await language('C11', 'C', 'c');
    kotlin = await language('KOTLIN', 'Kotlin', 'kt');
    python = await language('PY3', 'Python', 'py');
  });
  afterAll(() => worker.teardown());
  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      worker.similarityRuns.deleteMany({}),
      worker.similarityPairs.deleteMany({}),
      worker.submissions.deleteMany({}),
      worker.submissionSources.deleteMany({}),
      worker.contestSubmissions.deleteMany({}),
      worker.participations.deleteMany({}),
    ]);
    problem = await seedProblem(worker);
  });

  it('pairs a copy with renamed variables and leaves the unrelated solution out', async () => {
    const [ann, bob, cat] = await newUsers(3);
    const original = await submit(ann, SIEVE);
    const copy = await submit(bob, SIEVE_RENAMED);
    await submit(cat, KNAPSACK);
    const { run, pairs } = await runAndLoad();
    expect(run).toMatchObject({ status: 'done', active: false, error: null });
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeGreaterThan(0.9);
    expect(idsOf(pairs[0])).toEqual([original._id, copy._id].sort());
    expect(pairs[0].fragments.length).toBeGreaterThan(0);
    expect(run.groups).toMatchObject([
      {
        language: 'cpp',
        tokenizer: 'syntax',
        submissionCount: 3,
        comparedCount: 3,
        truncated: false,
        pairCount: 1,
        failed: false,
      },
    ]);
  });

  it('leaves out sources that never ran: compile errors and unjudged submissions', async () => {
    const [ann, bob, cat, dan] = await newUsers(4);
    const original = await submit(ann, SIEVE);
    const copy = await submit(bob, SIEVE_RENAMED);
    await submit(cat, SIEVE, { result: 'CE' });
    await submit(dan, SIEVE, { status: 'QU', result: null });
    const { run, pairs } = await runAndLoad();
    expect(pairs.map(idsOf)).toEqual([[original._id, copy._id].sort()]);
    expect(run.groups[0]).toMatchObject({
      submissionCount: 2,
      comparedCount: 2,
    });
  });

  it('never pairs two submissions of one user', async () => {
    const [ann, bob] = await newUsers(2);
    const first = await submit(ann, SIEVE);
    const second = await submit(ann, SIEVE_RENAMED);
    expect((await runAndLoad()).pairs).toHaveLength(0);
    await submit(bob, SIEVE);
    const { pairs } = await runAndLoad();
    expect(pairs).toHaveLength(2);
    for (const pair of pairs)
      expect(uuidStr(pair.left.user)).not.toBe(uuidStr(pair.right.user));
    const keys = pairs.map((pair) => idsOf(pair).join());
    expect(keys).not.toContain([first._id, second._id].sort().join());
  });

  it('compares C with C++ as one family and lists languages without a grammar', async () => {
    const [ann, bob, cat] = await newUsers(3);
    const inCpp = await submit(ann, SIEVE);
    const inC = await submit(bob, SIEVE_RENAMED, { language: plainC._id });
    await submit(cat, 'fun main() { println(1) }', { language: kotlin._id });
    const { run, pairs } = await runAndLoad();
    expect(pairs.map(idsOf)).toEqual([[inCpp._id, inC._id].sort()]);
    expect(run.groups).toMatchObject([
      { language: 'cpp', submissionCount: 2, pairCount: 1 },
    ]);
    expect(run.unsupported).toEqual([
      { language: 'Kotlin', submissionCount: 1 },
    ]);
  });

  it('skips empty and oversize sources and counts them without failing', async () => {
    const [ann, bob, cat, dan] = await newUsers(4);
    await submit(ann, SIEVE);
    await submit(bob, SIEVE_RENAMED);
    await submit(cat, '   \n');
    await submit(dan, 'é'.repeat(40_000)); // 40k characters (inside the schema cap), 80k bytes
    const { run, pairs } = await runAndLoad();
    expect(run.status).toBe('done');
    expect(pairs).toHaveLength(1);
    expect(run.groups[0]).toMatchObject({
      submissionCount: 4,
      comparedCount: 2,
      skippedEmpty: 1,
      skippedTooLarge: 1,
    });
  });

  it('compares only the newest submissions past the cap and says it truncated', async () => {
    const submissions = [];
    for (const userId of await newUsers(5))
      submissions.push(await submit(userId, SIEVE));
    const newest = submissions.slice(2).map((submission) => submission._id);
    const { run, pairs } = await runAndLoad({
      limits: { ...limits, maxSubmissions: 3 },
    });
    expect(run.groups[0]).toMatchObject({
      submissionCount: 5,
      comparedCount: 3,
      truncated: true,
    });
    expect(pairs).toHaveLength(3);
    for (const pair of pairs)
      for (const id of idsOf(pair)) expect(newest).toContain(id);
  });

  it('stores at most maxPairs pairs for the whole run', async () => {
    for (const userId of await newUsers(4)) await submit(userId, SIEVE);
    const { run, pairs } = await runAndLoad({
      limits: { ...limits, maxPairs: 2 },
    });
    expect(pairs).toHaveLength(2);
    expect(run.groups[0].pairCount).toBe(2);
  });

  it('applies maxPairs across groups, keeping the best pairs of any group', async () => {
    const users = await newUsers(6);
    for (const userId of users.slice(0, 3)) await submit(userId, SIEVE);
    for (const userId of users.slice(3))
      await submit(userId, 'print(1)', { language: python._id });
    // Two pairs per group: the run keeps the best of each, not both of the first.
    fakeEngine(({ family, submissions: [first, second, third] }) =>
      family.name === 'cpp'
        ? [fakePair(first, second, 0.95), fakePair(first, third, 0.6)]
        : [fakePair(first, second, 0.9), fakePair(first, third, 0.7)],
    );
    const { run, pairs } = await runAndLoad({
      limits: { ...limits, maxPairs: 2 },
    });
    expect(pairs.map((pair) => pair.similarity)).toEqual([0.95, 0.9]);
    expect(
      run.groups.map(({ language, pairCount }) => [language, pairCount]),
    ).toEqual(
      expect.arrayContaining([
        ['cpp', 1],
        ['python', 1],
      ]),
    );
  });

  it('lists a group the engine fails on as failed and still completes the run', async () => {
    const users = await newUsers(4);
    await submit(users[0], SIEVE);
    await submit(users[1], SIEVE_RENAMED);
    await submit(users[2], 'print(1)', { language: python._id });
    await submit(users[3], 'print(1)', { language: python._id });
    fakeEngine(({ family, submissions: [first, second] }) => {
      if (family.name === 'cpp')
        throw new SimilarityEngineError('engine_failed');
      return [fakePair(first, second, 0.8)];
    });
    const { run, pairs } = await runAndLoad();
    expect(run).toMatchObject({ status: 'done', error: null });
    const byLanguage = new Map(
      run.groups.map((group) => [group.language, group]),
    );
    expect(byLanguage.get('cpp')).toMatchObject({
      failed: true,
      pairCount: 0,
      submissionCount: 2,
    });
    expect(byLanguage.get('python')).toMatchObject({
      failed: false,
      pairCount: 1,
    });
    expect(pairs.map((pair) => pair.language)).toEqual(['python']);
  });

  it('stores well-formed line ranges only, at most the fragment cap per pair', async () => {
    await submit(await newUser(), SIEVE);
    await submit(await newUser(), SIEVE_RENAMED);
    const inverted = { leftStart: 9, leftEnd: 3, rightStart: 1, rightEnd: 2 };
    const wellFormed = { leftStart: 1, leftEnd: 3, rightStart: 4, rightEnd: 6 };
    const tooMany = DEFAULT_MAX_FRAGMENTS_PER_PAIR + 10;
    fakeEngine(({ submissions: [first, second] }) => [
      {
        ...fakePair(first, second, 0.8),
        fragments: [
          inverted,
          ...Array.from({ length: tooMany }, () => wellFormed),
        ],
      },
    ]);
    const { pairs } = await runAndLoad();
    expect(pairs[0].fragments).toHaveLength(DEFAULT_MAX_FRAGMENTS_PER_PAIR);
    for (const fragment of pairs[0].fragments) {
      expect(fragment.leftEnd).toBeGreaterThanOrEqual(fragment.leftStart);
      expect(fragment.rightEnd).toBeGreaterThanOrEqual(fragment.rightStart);
    }
  });

  it('compares a contest per contest problem, live and spectating participations only', async () => {
    const second = await seedProblem(worker);
    const contest: Contest = await seedContest(worker, {
      problems: [problem, second].map((entry, order) => ({
        problem: entry._id,
        points: 100,
        partial: true,
        isPretested: false,
        order,
        outputPrefixOverride: null,
        maxSubmissions: null,
      })),
    });
    const inContest = async (
      userId: string,
      virtual: number,
      source: string,
    ) => {
      const participation = await seedParticipation(
        worker,
        contest._id,
        userId,
        { virtual },
      );
      const submission = await seedContestSubmission(
        worker,
        participation,
        problem._id,
        { language: cpp._id },
      );
      await worker.submissionSources.create({ _id: submission._id, source });
      return submission;
    };
    const [ann, bob, cat, dan] = await newUsers(4);
    const live = await inContest(ann, 0, SIEVE);
    const spectating = await inContest(bob, SPECTATE, SIEVE_RENAMED);
    await inContest(cat, 1, SIEVE); // a virtual participation: out
    await submit(dan, SIEVE); // the same problem outside the contest: out
    const { run, pairs } = await runAndLoad({
      scope: 'contest',
      scopeKey: `contest:${contest._id}`,
      problem: null,
      contest: contest._id,
    });
    expect(pairs).toHaveLength(1);
    expect(idsOf(pairs[0])).toEqual([live._id, spectating._id].sort());
    expect(run.groups.map((group) => uuidStr(group.problem))).toEqual([
      problem._id,
    ]);
    expect(run.groups[0].submissionCount).toBe(2);
  });

  it('records a failed run without touching the previous results, and the next success replaces them', async () => {
    const [ann, bob] = await newUsers(2);
    await submit(ann, SIEVE);
    await submit(bob, SIEVE_RENAMED);
    const first = await runAndLoad();
    expect(first.pairs).toHaveLength(1);

    jest
      .spyOn(engine, 'compare')
      .mockRejectedValueOnce(new SimilarityEngineError('deadline'));
    const failed = await runAndLoad();
    expect(failed.run).toMatchObject({
      status: 'failed',
      active: false,
      error: 'deadline',
    });
    expect(failed.pairs).toHaveLength(0);
    expect(
      await worker.similarityPairs.countDocuments({ run: first.run._id }),
    ).toBe(1);

    const third = await runAndLoad();
    expect(third.pairs).toHaveLength(1);
    expect(await worker.similarityRuns.countDocuments({})).toBe(1);
    expect(
      await worker.similarityPairs.countDocuments({ run: first.run._id }),
    ).toBe(0);
  });

  it('writes nothing for a run abandoned while it compared, and keeps the previous results', async () => {
    await submit(await newUser(), SIEVE);
    await submit(await newUser(), SIEVE_RENAMED);
    const previous = await runAndLoad();
    const realCompare = engine.compare.bind(engine);
    // What the api's stale-run release does to a run past its time.
    fakeEngine(async (request) => {
      await worker.similarityRuns.updateOne(
        { status: 'running' },
        { status: 'failed', active: false, error: 'abandoned' },
      );
      return realCompare(request);
    });
    const abandoned = await runAndLoad();
    expect(abandoned.run).toMatchObject({
      status: 'failed',
      error: 'abandoned',
      groups: [],
    });
    expect(abandoned.pairs).toHaveLength(0);
    expect(await loadRun(previous.run._id)).toMatchObject({
      run: { status: 'done' },
      pairs: [expect.anything()],
    });
  });

  it('records an unexpected error as internal_error without its message', async () => {
    await submit(await newUser(), SIEVE);
    await submit(await newUser(), SIEVE_RENAMED);
    jest
      .spyOn(engine, 'compare')
      .mockRejectedValueOnce(new Error('/srv/secret/path exploded'));
    const { run } = await runAndLoad();
    expect(run).toMatchObject({ status: 'failed', error: 'internal_error' });
  });

  it('ignores a finished run (a redelivered job) and an unknown run', async () => {
    await submit(await newUser(), SIEVE);
    await submit(await newUser(), SIEVE_RENAMED);
    const first = await runAndLoad();
    const spy = jest.spyOn(engine, 'compare');
    await service.run(first.run._id);
    await service.run(newId());
    expect(spy).not.toHaveBeenCalled();
    expect(await loadRun(first.run._id)).toMatchObject({
      run: { status: 'done' },
      pairs: [expect.anything()],
    });
  });

  it('fails a run left running by a stalled attempt, so its scope can start again', async () => {
    await submit(await newUser(), SIEVE);
    await submit(await newUser(), SIEVE_RENAMED);
    const spy = jest.spyOn(engine, 'compare');
    const { run } = await runAndLoad({
      status: 'running',
      startedAt: new Date(),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(run).toMatchObject({ status: 'failed', error: 'internal_error' });
    await expect(startRun()).resolves.toMatchObject({ status: 'queued' });
  });

  it('does not let markFailed overwrite a finished run', async () => {
    await submit(await newUser(), SIEVE);
    await submit(await newUser(), SIEVE_RENAMED);
    const { run } = await runAndLoad();
    await service.markFailed(run._id, 'internal_error');
    expect((await worker.similarityRuns.findById(run._id).lean())!.status).toBe(
      'done',
    );
  });
});
