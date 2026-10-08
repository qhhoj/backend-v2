import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { Problem, SubmissionCase } from '@libs/database';
import { TEST_REDIS_URL } from '@libs/common/testing';
import {
  GRADED_ENQUEUE_TIMEOUT_MS,
  SubmissionEventsService,
} from '@libs/judging';
import { recordSubmissionEvents } from '@libs/judging/testing';
import type { SubmissionGradedJob } from '@libs/judging';
import {
  GradingService,
  PROGRESS_EVENT_INTERVAL_MS,
  LOST_JUDGE_MESSAGE,
} from '../src/submissions/grading.service';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import { seedCatalog, seedProblem, seedSubmission } from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const JUDGE = 'judge-01';
const reported = (
  position: number,
  extra: Partial<SubmissionCase> = {},
): SubmissionCase => ({
  position,
  status: 'AC',
  time: position / 10,
  memory: position * 1000,
  points: 1,
  total: 1,
  batch: null,
  feedback: '',
  extendedFeedback: '',
  output: '',
  ...extra,
});

describe('Grading (bridge Mongo layer)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let repository: SubmissionsRepository;
  let grading: GradingService;
  let codes = 0;
  const nextCode = () => {
    codes += 1;
    return `p${codes}`;
  };
  /** A problem and a submission claimed by `JUDGE`. */
  const claimed = async (problemFields: Partial<Problem> = {}) => {
    const problem = await seedProblem(bridge, catalog, {
      code: nextCode(),
      ...problemFields,
    });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const [queued] = await repository.loadQueued([submission._id]);
    const claim = await grading.claim(queued, JUDGE);
    if (claim) grading.sent(claim.subject);
    return { problem, id: submission._id, queued, request: claim?.request };
  };
  const stored = async (id: string) =>
    (await bridge.submissions.findById(id).select('+cases').lean())!;

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    repository = bridge.module.get(SubmissionsRepository);
    grading = bridge.module.get(GradingService);
  });
  beforeEach(() => bridge.graded.obliterate({ force: true }));
  afterAll(() => bridge.teardown());

  it('loads queued submissions in priority then id order, mirrors under their root code', async () => {
    const root = await seedProblem(bridge, catalog, { code: 'root' });
    const mirror = await seedProblem(bridge, catalog, {
      code: 'mirror',
      mirrorOf: root._id,
      mirrorRoot: root._id,
    });
    const rejudge = await seedSubmission(bridge, catalog, {
      problem: root._id,
      priority: 2,
    });
    const fresh = await seedSubmission(bridge, catalog, {
      problem: mirror._id,
      language: catalog.python._id,
    });
    const done = await seedSubmission(bridge, catalog, {
      problem: root._id,
      status: 'D',
    });
    expect(
      await repository.loadQueued([rejudge._id, fresh._id, done._id]),
    ).toEqual([
      {
        id: fresh._id,
        problemCode: 'root',
        languageKey: 'PY3',
        priority: 1,
        judgeName: null,
        bannedJudges: [],
      },
      {
        id: rejudge._id,
        problemCode: 'root',
        languageKey: 'CPP17',
        priority: 2,
        judgeName: null,
        bannedJudges: [],
      },
    ]);
  });

  it('sends a file-only language its limits and the file URL made absolute against SITE_URL', async () => {
    const scratch = await bridge.languages.create({
      key: 'SCRATCH',
      name: 'Scratch',
      commonName: 'Scratch',
      ace: 'text',
      pygments: 'text',
      extension: 'sb3',
      fileOnly: true,
      fileSizeLimit: 5,
    });
    const problem = await seedProblem(bridge, catalog, {
      code: nextCode(),
      allowedLanguages: [catalog.cpp._id, scratch._id],
    });
    const requestFor = async (language: string, source: string) => {
      const submission = await seedSubmission(bridge, catalog, {
        problem: problem._id,
        language,
        source,
      });
      const [queued] = await repository.loadQueued([submission._id]);
      return (await grading.claim(queued, JUDGE))?.request;
    };
    expect(
      await requestFor(scratch._id, '/media/submission_file/p/u/a.sb3'),
    ).toMatchObject({
      source: 'http://localhost:5173/media/submission_file/p/u/a.sb3',
      fileOnly: true,
      fileSizeLimit: 5,
    });
    expect(
      await requestFor(scratch._id, 'https://cdn.test/submission_file/b.sb3'),
    ).toMatchObject({ source: 'https://cdn.test/submission_file/b.sb3' });
    expect(await requestFor(catalog.cpp._id, '/media/x.cpp')).toMatchObject({
      source: '/media/x.cpp',
      fileOnly: false,
      fileSizeLimit: 0,
    });
  });

  it('claims a queued submission once and builds the request from the problem', async () => {
    const problem = await seedProblem(bridge, catalog, {
      code: nextCode(),
      partial: false,
      timeLimit: 2,
      memoryLimit: 262144,
      languageLimits: [
        { languageId: catalog.cpp._id, timeLimit: 5, memoryLimit: 65536 },
      ],
    });
    const hourAgo = new Date(Date.now() - 3600_000);
    await seedSubmission(bridge, catalog, {
      problem: problem._id,
      status: 'D',
      date: hourAgo,
    });
    await seedSubmission(bridge, catalog, {
      problem: problem._id,
      status: 'CE',
      date: hourAgo,
    });
    const cpp = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      source: '#include <cstdio>',
    });
    const python = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      language: catalog.python._id,
    });
    const [cppQueued, pythonQueued] = await repository.loadQueued([
      cpp._id,
      python._id,
    ]);
    expect((await grading.claim(cppQueued, JUDGE))?.request).toEqual({
      submissionId: cpp._id,
      problemCode: problem.code,
      languageKey: 'CPP17',
      source: '#include <cstdio>',
      timeLimit: 5,
      memoryLimit: 65536,
      shortCircuit: true,
      pretestsOnly: false,
      inContest: null,
      attemptNo: 2,
      userId: catalog.user._id,
      fileOnly: false,
      fileSizeLimit: 0,
    });
    expect(await stored(cpp._id)).toMatchObject({
      status: 'P',
      judgedOn: JUDGE,
    });
    expect(await grading.claim(cppQueued, 'judge-02')).toBeNull();
    expect((await grading.claim(pythonQueued, JUDGE))?.request).toMatchObject({
      timeLimit: 2,
      memoryLimit: 262144,
    });
  });

  it('finishes as IE, with its graded job, a claimed submission whose problem vanished', async () => {
    const problem = await seedProblem(bridge, catalog, { code: nextCode() });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const [queued] = await repository.loadQueued([submission._id]);
    await bridge.problems.deleteOne({ _id: problem._id });
    expect(await grading.claim(queued, JUDGE)).toBeNull();
    expect(await stored(submission._id)).toMatchObject({
      status: 'IE',
      result: 'IE',
      error: 'Submission data is missing',
    });
    expect(
      (await bridge.gradedJobs()).map((job) => job.submissionId),
    ).toContain(submission._id);
  });

  it('grades a batched run: worst case, batch minimum, points scaled for a partial problem', async () => {
    const { id, problem } = await claimed({ points: 1000, partial: true });
    await grading.beginGrading(id, JUDGE, false);
    expect(await stored(id)).toMatchObject({
      status: 'G',
      currentTestcase: 1,
      cases: [],
    });
    await grading.markBatched(id, JUDGE);
    await grading.addCases(id, JUDGE, [
      reported(1, { batch: 1 }),
      reported(2, { batch: 1, status: 'WA', points: 0 }),
    ]);
    await grading.addCases(id, JUDGE, [reported(3)]);
    await grading.gradingEnd(id, JUDGE);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'WA',
      batch: true,
      casePoints: 1,
      caseTotal: 2,
      points: 500,
      time: 0.3,
      memory: 3000,
      currentTestcase: 4,
    });
    expect(await bridge.gradedJobs()).toEqual([
      { submissionId: id, userId: catalog.user._id, problemId: problem._id },
    ]);
  });

  it('zeroes a non-partial result short of full marks and keeps full marks', async () => {
    const short = await claimed({ points: 1000, partial: false });
    const full = await claimed({ points: 1000, partial: false });
    for (const { id } of [short, full])
      await grading.beginGrading(id, JUDGE, false);
    await grading.addCases(short.id, JUDGE, [
      reported(1),
      reported(2, { status: 'WA', points: 0 }),
    ]);
    await grading.addCases(full.id, JUDGE, [reported(1), reported(2)]);
    for (const { id } of [short, full]) await grading.gradingEnd(id, JUDGE);
    expect((await stored(short.id)).points).toBe(0);
    expect((await stored(full.id)).points).toBe(1000);
  });

  it('ignores stale packets: another judge, a repeated end, cases after the end', async () => {
    const { id } = await claimed();
    await grading.beginGrading(id, JUDGE, false);
    expect(await grading.addCases(id, 'judge-02', [reported(1)])).toBe('stale');
    await grading.addCases(id, JUDGE, [reported(1)]);
    await grading.gradingEnd(id, JUDGE);
    await grading.gradingEnd(id, JUDGE);
    expect(await grading.addCases(id, JUDGE, [reported(2)])).toBe('stale');
    await grading.beginGrading(id, JUDGE, true);
    await grading.terminated(id, JUDGE);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'AC',
      isPretested: false,
    });
    expect((await stored(id)).cases).toHaveLength(1);
    expect(await bridge.gradedJobs()).toHaveLength(1);
  });

  it('keeps compile messages and finishes on compile errors, internal errors and termination', async () => {
    const compiled = await claimed();
    await grading.compileMessage(compiled.id, JUDGE, 'warning: unused');
    expect(await stored(compiled.id)).toMatchObject({
      status: 'P',
      error: 'warning: unused',
    });
    await grading.compileError(compiled.id, JUDGE, 'error: expected ;');
    const crashed = await claimed();
    await grading.beginGrading(crashed.id, JUDGE, false);
    await grading.internalError(crashed.id, JUDGE, 'Traceback');
    const aborted = await claimed();
    await grading.beginGrading(aborted.id, JUDGE, false);
    await grading.terminated(aborted.id, JUDGE);
    expect(await stored(compiled.id)).toMatchObject({
      status: 'CE',
      result: 'CE',
      error: 'error: expected ;',
    });
    expect(await stored(crashed.id)).toMatchObject({
      status: 'IE',
      result: 'IE',
      error: 'Traceback',
    });
    expect(await stored(aborted.id)).toMatchObject({
      status: 'AB',
      result: 'AB',
      points: 0,
    });
    expect(
      (await bridge.gradedJobs()).map((job) => job.submissionId).sort(),
    ).toEqual([compiled.id, crashed.id, aborted.id].sort());
  });

  it('refuses cases beyond 10000 per submission without writing', async () => {
    const { id } = await claimed();
    await grading.beginGrading(id, JUDGE, false);
    const many = Array.from({ length: 9999 }, (_unused, index) =>
      reported(index + 1),
    );
    expect(await grading.addCases(id, JUDGE, many)).toBe('appended');
    expect(
      await grading.addCases(id, JUDGE, [reported(10000), reported(10001)]),
    ).toBe('full');
    expect((await stored(id)).cases).toHaveLength(9999);
    expect(await grading.addCases(id, JUDGE, [reported(10000)])).toBe(
      'appended',
    );
    expect((await stored(id)).cases).toHaveLength(10000);
    expect(await grading.addCases(id, JUDGE, [reported(10001)])).toBe('full');
    expect((await stored(id)).cases).toHaveLength(10000);
  });

  it('requeues on the first judge loss and fails on the second', async () => {
    const { id } = await claimed();
    await grading.beginGrading(id, JUDGE, false);
    await grading.addCases(id, JUDGE, [reported(1)]);
    expect(await grading.disconnected(id, JUDGE)).toBe('requeued');
    expect(await stored(id)).toMatchObject({
      status: 'QU',
      requeueCount: 1,
      judgedOn: null,
      cases: [],
    });
    expect(await bridge.gradedJobs()).toEqual([]);
    const [queued] = await repository.loadQueued([id]);
    await grading.claim(queued, 'judge-02');
    expect(await grading.disconnected(id, 'judge-02')).toBe('failed');
    expect(await stored(id)).toMatchObject({
      status: 'IE',
      result: 'IE',
      error: LOST_JUDGE_MESSAGE,
    });
    expect(await bridge.gradedJobs()).toHaveLength(1);
    expect(await grading.disconnected(id, 'judge-02')).toBe('stale');
  });

  it('releases an unsent claim without spending the requeue', async () => {
    const { id } = await claimed();
    expect(await repository.release(id, 'judge-02')).toBe(false);
    expect(await repository.release(id, JUDGE)).toBe(true);
    expect(await stored(id)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      requeueCount: 0,
    });
  });

  it('ignores every packet from a judge that does not hold the submission', async () => {
    const { id } = await claimed();
    await grading.compileMessage(id, 'judge-02', 'warning');
    await grading.compileError(id, 'judge-02', 'error');
    await grading.internalError(id, 'judge-02', 'boom');
    await grading.terminated(id, 'judge-02');
    expect(await grading.disconnected(id, 'judge-02')).toBe('stale');
    await grading.beginGrading(id, 'judge-02', true);
    expect(await stored(id)).toMatchObject({
      status: 'P',
      judgedOn: JUDGE,
      error: null,
      requeueCount: 0,
    });
    await grading.beginGrading(id, JUDGE, false);
    await grading.markBatched(id, 'judge-02');
    await grading.gradingEnd(id, 'judge-02');
    expect(await stored(id)).toMatchObject({ status: 'G', batch: false });
    expect(await bridge.gradedJobs()).toEqual([]);
  });

  it('ignores packets for a finished submission', async () => {
    const { id } = await claimed();
    await grading.compileError(id, JUDGE, 'error: expected ;');
    await grading.internalError(id, JUDGE, 'late');
    await grading.compileMessage(id, JUDGE, 'late');
    await grading.beginGrading(id, JUDGE, false);
    expect(await grading.disconnected(id, JUDGE)).toBe('stale');
    expect(await stored(id)).toMatchObject({
      status: 'CE',
      error: 'error: expected ;',
    });
    expect(await bridge.gradedJobs()).toHaveLength(1);
  });

  it.each([
    [
      'source',
      (bridge_: BridgeTest, id: string) =>
        bridge_.sources.deleteOne({ _id: id }),
    ],
    [
      'problem',
      (bridge_: BridgeTest, id: string, problemId: string) =>
        bridge_.problems.deleteOne({ _id: problemId }),
    ],
  ])(
    'finishes a claimed submission as IE, with one graded job, when its %s is gone',
    async (_name, remove) => {
      const problem = await seedProblem(bridge, catalog, { code: nextCode() });
      const submission = await seedSubmission(bridge, catalog, {
        problem: problem._id,
      });
      const [queued] = await repository.loadQueued([submission._id]);
      await remove(bridge, submission._id, problem._id);
      expect(await grading.claim(queued, JUDGE)).toBeNull();
      expect(await stored(submission._id)).toMatchObject({
        status: 'IE',
        result: 'IE',
      });
      expect(await bridge.gradedJobs()).toEqual([
        {
          submissionId: submission._id,
          userId: catalog.user._id,
          problemId: problem._id,
        },
      ]);
    },
  );

  it('treats an empty case packet as a no-op', async () => {
    const { id } = await claimed();
    await grading.beginGrading(id, JUDGE, false);
    expect(await grading.addCases(id, JUDGE, [])).toBe('stale');
    expect(await stored(id)).toMatchObject({ currentTestcase: 1, cases: [] });
  });

  it('puts a claimed submission back in the queue when building its request throws', async () => {
    const problem = await seedProblem(bridge, catalog, { code: nextCode() });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const [queued] = await repository.loadQueued([submission._id]);
    jest.spyOn(bridge.problems, 'findById').mockImplementationOnce(() => {
      throw new Error('mongo hiccup');
    });
    expect(await grading.claim(queued, JUDGE)).toBeNull();
    expect(await stored(submission._id)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      requeueCount: 0,
    });
    expect((await grading.claim(queued, JUDGE))?.request).toMatchObject({
      submissionId: submission._id,
    });
  });

  it('still finishes a submission whose problem was deleted mid-grading, with no points', async () => {
    const { id, problem } = await claimed();
    await grading.beginGrading(id, JUDGE, false);
    await grading.addCases(id, JUDGE, [reported(1)]);
    await bridge.problems.deleteOne({ _id: problem._id });
    await grading.gradingEnd(id, JUDGE);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'AC',
      points: 0,
    });
  });

  it('never stalls judge packets while the events Redis is down', async () => {
    const unreachable = new Redis('redis://10.255.255.1:6379', {
      maxRetriesPerRequest: 3,
      connectTimeout: 500,
    });
    unreachable.on('error', () => undefined);
    const offline = new GradingService(
      repository,
      bridge.graded,
      new SubmissionEventsService(unreachable),
    );
    const timed = async (action: () => Promise<unknown>) => {
      const started = Date.now();
      await action();
      return Date.now() - started;
    };
    const problem = await seedProblem(bridge, catalog, { code: nextCode() });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const [queued] = await repository.loadQueued([submission._id]);
    const durations: number[] = [];
    let claim: Awaited<ReturnType<GradingService['claim']>> = null;
    durations.push(
      await timed(async () => {
        claim = await offline.claim(queued, JUDGE);
      }),
    );
    durations.push(
      await timed(() => Promise.resolve(offline.sent(claim!.subject))),
    );
    durations.push(
      await timed(() => offline.beginGrading(submission._id, JUDGE, false)),
    );
    for (let position = 1; position <= 3; position += 1)
      durations.push(
        await timed(() =>
          offline.addCases(submission._id, JUDGE, [reported(position)]),
        ),
      );
    durations.push(
      await timed(() => offline.gradingEnd(submission._id, JUDGE)),
    );
    unreachable.disconnect();
    expect(Math.max(...durations)).toBeLessThan(100);
    expect(await stored(submission._id)).toMatchObject({ status: 'D' });
  });

  it('finishes promptly, with the verdict stored, when the graded queue never answers', async () => {
    // BullMQ's `add` never rejects while Redis is down: it waits forever.
    const hanging = {
      add: () => new Promise<never>(() => undefined),
    } as unknown as Queue<SubmissionGradedJob>;
    const offline = new GradingService(
      repository,
      hanging,
      bridge.module.get(SubmissionEventsService),
    );
    const { id } = await claimed();
    await grading.beginGrading(id, JUDGE, false);
    await grading.addCases(id, JUDGE, [reported(1)]);
    const started = Date.now();
    await offline.gradingEnd(id, JUDGE);
    expect(Date.now() - started).toBeLessThan(GRADED_ENQUEUE_TIMEOUT_MS * 3);
    expect(await stored(id)).toMatchObject({ status: 'D', result: 'AC' });
    expect(await bridge.gradedJobs()).toEqual([]);
  });

  describe('events', () => {
    let recorder: Awaited<ReturnType<typeof recordSubmissionEvents>>;
    const eventsOf = (id: string) =>
      recorder.events.filter((event) => event.submissionId === id);
    const typesAndStatuses = (id: string) =>
      eventsOf(id).map(({ type, status }) => [type, status]);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
    beforeEach(async () => {
      recorder = await recordSubmissionEvents(TEST_REDIS_URL);
    });
    afterEach(() => recorder.stop());

    it('publishes each status change once, throttles progress and always sends done', async () => {
      const { id, problem } = await claimed();
      const trackedWhileClaimed = grading.trackedCount();
      await grading.beginGrading(id, JUDGE, false);
      const started = Date.now();
      for (let position = 1; position <= 20; position += 1)
        await grading.addCases(id, JUDGE, [reported(position)]);
      const elapsed = Date.now() - started;
      await grading.gradingEnd(id, JUDGE);
      await grading.gradingEnd(id, JUDGE);
      await recorder.waitFor(() =>
        eventsOf(id).some((event) => event.type === 'done'),
      );
      await settle();
      const events = eventsOf(id);
      const types = events.map((event) => event.type);
      expect(types.slice(0, 2)).toEqual(['processing', 'grading-begin']);
      expect(types.at(-1)).toBe('done');
      expect(types.filter((type) => type === 'done')).toHaveLength(1);
      const progress = events.filter((event) => event.type === 'test-case');
      expect(progress.length).toBeGreaterThanOrEqual(1);
      expect(progress.length).toBeLessThanOrEqual(
        Math.ceil(elapsed / PROGRESS_EVENT_INTERVAL_MS) + 1,
      );
      expect(progress[0].currentTestcase).toBe(2);
      expect(events.at(-1)).toMatchObject({ status: 'D', currentTestcase: 0 });
      for (const event of events) {
        expect(event).toMatchObject({
          userId: catalog.user._id,
          problemId: problem._id,
        });
      }
      expect(grading.trackedCount()).toBe(trackedWhileClaimed - 1);
    });

    it('publishes queued when a judge loss requeues, and done IE when the second loss fails it', async () => {
      const { id } = await claimed();
      const trackedWhileClaimed = grading.trackedCount();
      expect(await grading.disconnected(id, JUDGE)).toBe('requeued');
      const [queued] = await repository.loadQueued([id]);
      grading.sent((await grading.claim(queued, JUDGE))!.subject);
      expect(await grading.disconnected(id, JUDGE)).toBe('failed');
      await recorder.waitFor(() => eventsOf(id).length === 4);
      expect(typesAndStatuses(id)).toEqual([
        ['processing', 'P'],
        ['queued', 'QU'],
        ['processing', 'P'],
        ['done', 'IE'],
      ]);
      expect(grading.trackedCount()).toBe(trackedWhileClaimed - 1);
    });

    it('publishes queued when an unsent claim is released', async () => {
      const { id } = await claimed();
      const trackedWhileClaimed = grading.trackedCount();
      expect(await grading.release(id, 'judge-02')).toBe(false);
      expect(await grading.release(id, JUDGE)).toBe(true);
      await recorder.waitFor(() => eventsOf(id).length === 2);
      expect(typesAndStatuses(id)).toEqual([
        ['processing', 'P'],
        ['queued', 'QU'],
      ]);
      expect(grading.trackedCount()).toBe(trackedWhileClaimed - 1);
    });

    it('publishes queued for every submission a start or a resync returns to the queue without a judge loss', async () => {
      const { id: stranded } = await claimed();
      const { id: other } = await claimed();
      const trackedBefore = grading.trackedCount();
      const claims = (await repository.inFlightClaims()).filter(
        (claim) => claim.id === stranded,
      );
      grading.announceRequeued(await repository.resetStranded(claims));
      await recorder.waitFor(() =>
        eventsOf(stranded).some((event) => event.type === 'queued'),
      );
      expect(typesAndStatuses(stranded)).toEqual([
        ['processing', 'P'],
        ['queued', 'QU'],
      ]);
      expect(typesAndStatuses(other)).toEqual([['processing', 'P']]);
      expect(grading.trackedCount()).toBe(trackedBefore - 1);
      grading.announceRequeued(await repository.resetInFlight());
      await recorder.waitFor(() =>
        eventsOf(other).some((event) => event.type === 'queued'),
      );
      expect(typesAndStatuses(other)).toEqual([
        ['processing', 'P'],
        ['queued', 'QU'],
      ]);
      expect(await stored(other)).toMatchObject({
        status: 'QU',
        requeueCount: 0,
      });
      expect(grading.trackedCount()).toBeLessThan(trackedBefore - 1);
    });

    it('publishes nothing and tracks nothing for a claim the judge never received', async () => {
      const problem = await seedProblem(bridge, catalog, { code: nextCode() });
      const submission = await seedSubmission(bridge, catalog, {
        problem: problem._id,
      });
      const [queued] = await repository.loadQueued([submission._id]);
      const trackedBefore = grading.trackedCount();
      const findSource = bridge.sources.findById.bind(bridge.sources);
      let loseJudge = Promise.resolve('' as string);
      jest.spyOn(bridge.sources, 'findById').mockImplementationOnce(((
        sourceId: string,
      ) => {
        // the judge's socket closes while the claim is still reading
        loseJudge = grading.disconnected(submission._id, JUDGE);
        return findSource(sourceId);
      }) as never);
      await grading.claim(queued, JUDGE);
      expect(await loseJudge).toBe('requeued');
      await settle();
      expect(eventsOf(submission._id)).toEqual([]);
      expect(grading.trackedCount()).toBe(trackedBefore);
    });

    it('publishes nothing for packets of a judge that does not hold the submission', async () => {
      const { id } = await claimed();
      await grading.beginGrading(id, 'judge-02', false);
      await grading.addCases(id, 'judge-02', [reported(1)]);
      await grading.compileError(id, 'judge-02', 'nope');
      await settle();
      expect(eventsOf(id).map((event) => event.type)).toEqual(['processing']);
      await grading.compileError(id, JUDGE, 'error: expected ;');
      await recorder.waitFor(() => eventsOf(id).length === 2);
      expect(eventsOf(id)[1]).toMatchObject({ type: 'done', status: 'CE' });
    });
  });
});
