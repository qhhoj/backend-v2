import { Logger } from '@nestjs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import type { SubmissionCase } from '@libs/database';
import { recordSubmissionEvents } from '@libs/judging/testing';
import type { AssignmentRef } from '@libs/judge-proto';
import type { FinalReport } from '../src/link/messages';
import {
  LOST_JUDGE_MESSAGE,
  PROGRESS_EVENT_INTERVAL_MS,
  RunsService,
} from '../src/submissions/runs.service';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import { seedCatalog, seedProblem, seedSubmission } from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const JUDGE = 'judge-01';
const reported = (position: number): SubmissionCase => ({
  position,
  status: 'AC',
  time: 0.1,
  memory: 1000,
  points: 1,
  total: 1,
  batch: null,
  feedback: '',
  extendedFeedback: '',
  output: '',
});
const final = (fields: Partial<FinalReport> = {}): FinalReport => ({
  kind: 'graded',
  log: '',
  dataVersionUsed: 0,
  ...fields,
});

describe('RunsService (events and graded jobs of a run)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let runs: RunsService;
  let repository: SubmissionsRepository;
  let recorder: Awaited<ReturnType<typeof recordSubmissionEvents>>;
  let codes = 0;
  const eventsOf = (id: string) =>
    recorder.events.filter((event) => event.submissionId === id);
  const typesAndStatuses = (id: string) =>
    eventsOf(id).map(({ type, status }) => [type, status]);
  const stored = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;
  /** Claims (or re-claims) `id` for JUDGE and marks it sent; `key(seq)` names the run. */
  const claim = async (id: string) => {
    const [queued] = await repository.loadQueued([id]);
    const claimed = (await runs.claim(queued, JUDGE))!;
    runs.sent(claimed);
    const ref: AssignmentRef = claimed.request.ref;
    return { ref, key: (seq: number) => ({ ref, judgeName: JUDGE, seq }) };
  };
  const newRun = async () => {
    const problem = await seedProblem(bridge, catalog, {
      code: `rs${(codes += 1)}`,
    });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    return { id: submission._id, problem, ...(await claim(submission._id)) };
  };

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    runs = bridge.module.get(RunsService);
    repository = bridge.module.get(SubmissionsRepository);
  });
  beforeEach(async () => {
    await bridge.graded.obliterate({ force: true });
    recorder = await recordSubmissionEvents(TEST_REDIS_URL);
  });
  afterEach(() => recorder.stop());
  afterAll(() => bridge.teardown());

  it('publishes each status change once, throttles progress, and enqueues one graded job named by the run even when Final is resent', async () => {
    const { id, problem, key } = await newRun();
    await runs.accepted(key(1));
    await runs.started(key(2), false);
    const started = Date.now();
    for (let seq = 3; seq <= 22; seq += 1)
      await runs.cases(key(seq), [reported(seq - 2)]);
    const elapsed = Date.now() - started;
    expect(await runs.final(key(23), final())).toBe('applied');
    expect(await runs.final(key(23), final())).toBe('duplicate');
    await recorder.waitFor(() =>
      eventsOf(id).some((event) => event.type === 'done'),
    );
    const events = eventsOf(id);
    expect(events.map((event) => event.type).slice(0, 2)).toEqual([
      'processing',
      'grading-begin',
    ]);
    expect(events.filter((event) => event.type === 'done')).toEqual([
      expect.objectContaining({
        status: 'D',
        userId: catalog.user._id,
        problemId: problem._id,
      }),
    ]);
    const progress = events.filter((event) => event.type === 'test-case');
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress.length).toBeLessThanOrEqual(
      Math.ceil(elapsed / PROGRESS_EVENT_INTERVAL_MS) + 1,
    );
    const jobs = await bridge.graded.getJobs(['waiting']);
    expect(jobs.map((job) => job.id)).toEqual([`${id}.1`]);
  });

  it('ends CE, IE and AB runs with done and their status', async () => {
    for (const [kind, status] of [
      ['compile-error', 'CE'],
      ['internal-error', 'IE'],
      ['aborted', 'AB'],
    ] as const) {
      const { id, key } = await newRun();
      await runs.accepted(key(1));
      expect(await runs.final(key(2), final({ kind, log: 'x' }))).toBe(
        'applied',
      );
      await recorder.waitFor(() => eventsOf(id).length === 2);
      expect(typesAndStatuses(id)).toEqual([
        ['processing', 'P'],
        ['done', status],
      ]);
    }
  });

  it('publishes queued for a RETRY (a replay of it is a duplicate), and done IE with one graded job for the third', async () => {
    const warnings: string[] = [];
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message) => void warnings.push(String(message)));
    const { id, key } = await newRun();
    await runs.accepted(key(1));
    expect(
      await runs.final(key(2), final({ kind: 'retry', log: 'no data' })),
    ).toBe('applied');
    // the requeue cleared judgedOn: a replay of that Final is still re-acked, and changes nothing
    expect(
      await runs.final(key(2), final({ kind: 'retry', log: 'no data' })),
    ).toBe('duplicate');
    expect(await stored(id)).toMatchObject({ status: 'QU', retryCount: 1 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const again = await claim(id);
      await runs.accepted(again.key(1));
      await runs.final(
        again.key(2),
        final({ kind: 'retry', log: 'no data\nmount gone' }),
      );
    }
    warn.mockRestore();
    expect(warnings).toEqual([
      `Judge ${JUDGE} answered RETRY for submission ${id} gen 1 (requeued): no data`,
      `Judge ${JUDGE} answered RETRY for submission ${id} gen 2 (requeued): no data mount gone`,
      `Judge ${JUDGE} answered RETRY for submission ${id} gen 3 (internal error, retry cap reached): no data mount gone`,
    ]);
    expect((await stored(id)).effectsDueAt).toBeInstanceOf(Date);
    await recorder.waitFor(() =>
      eventsOf(id).some((event) => event.type === 'done'),
    );
    expect(typesAndStatuses(id)).toEqual([
      ['processing', 'P'],
      ['queued', 'QU'],
      ['processing', 'P'],
      ['queued', 'QU'],
      ['processing', 'P'],
      ['done', 'IE'],
    ]);
    expect(
      (await bridge.graded.getJobs(['waiting'])).map((job) => job.id),
    ).toEqual([`${id}.3`]);
  });

  it('requeues a run whose judge stayed away, fails it the second time, and aborts it when the api asked', async () => {
    const lost = await newRun();
    expect(await runs.graceExpired(lost.ref, JUDGE, false)).toBe('requeued');
    const again = await claim(lost.id);
    expect(await runs.graceExpired(again.ref, JUDGE, false)).toBe('failed');
    expect(await stored(lost.id)).toMatchObject({
      status: 'IE',
      error: LOST_JUDGE_MESSAGE,
      requeueCount: 1,
    });
    expect(await runs.graceExpired(again.ref, JUDGE, false)).toBe('stale');
    const aborted = await newRun();
    expect(await runs.graceExpired(aborted.ref, JUDGE, true)).toBe('aborted');
    expect(await stored(aborted.id)).toMatchObject({
      status: 'AB',
      requeueCount: 0,
    });
    await recorder.waitFor(() => eventsOf(aborted.id).length === 2);
    expect(typesAndStatuses(lost.id)).toEqual([
      ['processing', 'P'],
      ['queued', 'QU'],
      ['processing', 'P'],
      ['done', 'IE'],
    ]);
  });

  it('stops tracking a run the bridge let go of, but not a newer run of the same submission', async () => {
    const before = runs.trackedCount();
    const { ref } = await newRun();
    expect(runs.trackedCount()).toBe(before + 1);
    runs.forget({ ...ref, generation: ref.generation + 1 });
    expect(runs.trackedCount()).toBe(before + 1);
    runs.forget(ref);
    expect(runs.trackedCount()).toBe(before);
  });

  it('publishes queued when an unaccepted run is released, and nothing for another judge', async () => {
    const { id, ref } = await newRun();
    expect(await runs.release(ref, 'judge-02')).toBe(false);
    expect(await runs.release(ref, JUDGE)).toBe(true);
    await recorder.waitFor(() => eventsOf(id).length === 2);
    expect(typesAndStatuses(id)).toEqual([
      ['processing', 'P'],
      ['queued', 'QU'],
    ]);
  });
});
