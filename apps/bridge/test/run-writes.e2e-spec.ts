import type { Problem, SubmissionCase } from '@libs/database';
import type { AssignmentRef } from '@libs/judge-proto';
import {
  RETRY_LIMIT_MESSAGE,
  RunWritesRepository,
} from '../src/submissions/run-writes.repository';
import { DEFERRAL_LIMIT_MESSAGE } from '../src/submissions/deferral';
import { canJudge } from '../src/dispatch/slots';
import { RunsService } from '../src/submissions/runs.service';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import type { RunKey } from '../src/submissions/write-outcome';
import { seedCatalog, seedProblem, seedSubmission } from './fixtures';
import { RecordingJudge } from './recording-judge';
import type { BridgeCatalog } from './fixtures';
import { FAST_TIMINGS, setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const JUDGE = 'judge-01';
const reported = (
  position: number,
  extra: Partial<SubmissionCase> = {},
): SubmissionCase => ({
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
  ...extra,
});

describe('Run writes (seq compare-and-set)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let writes: RunWritesRepository;
  let repository: SubmissionsRepository;
  let runs: RunsService;
  let codes = 0;
  const stored = async (id: string) =>
    (await bridge.submissions.findById(id).select('+cases').lean())!;
  /** A submission claimed by `JUDGE`; `key(seq)` names its run. */
  const claimed = async (problemFields: Partial<Problem> = {}) => {
    const problem = await seedProblem(bridge, catalog, {
      code: `w${(codes += 1)}`,
      ...problemFields,
    });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const [queued] = await repository.loadQueued([submission._id]);
    const claim = await repository.claimRun(queued, JUDGE);
    if (!claim || !('request' in claim)) throw new Error('not claimed');
    const ref: AssignmentRef = claim.request.ref;
    const key = (seq: number, judgeName = JUDGE): RunKey => ({
      ref,
      judgeName,
      seq,
    });
    return { id: submission._id, ref, key };
  };

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    writes = bridge.module.get(RunWritesRepository);
    repository = bridge.module.get(SubmissionsRepository);
    runs = bridge.module.get(RunsService);
  });
  afterAll(() => bridge.teardown());

  it('applies a run in order, advancing judgeSeq, and grades it from the stored cases', async () => {
    const { id, key } = await claimed({ partial: true });
    expect(await writes.accept(key(1))).toBe('applied');
    expect(await writes.compiled(key(2), 'warning: x')).toBe('applied');
    expect(await writes.started(key(3), true)).toBe('applied');
    expect(await stored(id)).toMatchObject({
      status: 'G',
      isPretested: true,
      judgeSeq: 3,
    });
    expect(
      await writes.cases(key(4), [
        reported(1, { batch: 1 }),
        reported(2, { batch: 1, status: 'WA', points: 0 }),
      ]),
    ).toBe('applied');
    expect(await stored(id)).toMatchObject({
      batch: true,
      currentTestcase: 3,
      judgeSeq: 4,
    });
    const finished = await writes.finishGraded(key(5), 7);
    expect(finished.outcome).toBe('applied');
    expect(finished.job?.submissionId).toBe(id);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'WA',
      error: 'warning: x',
      judgeSeq: 5,
      judgedDataVersion: 7,
      casePoints: 0,
      caseTotal: 1,
    });
  });

  it('answers a replayed seq as a duplicate and stores nothing twice', async () => {
    const { id, key } = await claimed();
    await writes.accept(key(1));
    await writes.started(key(2), false);
    expect(await writes.cases(key(3), [reported(1)])).toBe('applied');
    expect(await writes.accept(key(1))).toBe('duplicate');
    expect(await writes.cases(key(3), [reported(1)])).toBe('duplicate');
    expect((await stored(id)).cases).toHaveLength(1);
    await writes.finishGraded(key(4), 0);
    expect(await writes.finishGraded(key(4), 0)).toEqual({
      outcome: 'duplicate',
      job: null,
    });
  });

  it('calls a skipped seq a gap and cases before Started out of order', async () => {
    const { key } = await claimed();
    await writes.accept(key(1));
    expect(await writes.started(key(3), false)).toBe('gap');
    expect(await writes.cases(key(2), [reported(1)])).toBe('order');
  });

  it('ignores another judge, another generation and a run requeued under it as stale', async () => {
    const { ref, key } = await claimed();
    await writes.accept(key(1));
    expect(await writes.started(key(2, 'judge-02'), false)).toBe('stale');
    expect(
      await writes.started(
        {
          ref: { ...ref, generation: ref.generation + 1 },
          judgeName: JUDGE,
          seq: 2,
        },
        false,
      ),
    ).toBe('stale');
    await repository.requeueRun(ref, JUDGE);
    expect(await writes.started(key(2), false)).toBe('stale');
  });

  it('refuses cases beyond 10000 per submission without writing, and advances the seq on an empty batch', async () => {
    const { id, key } = await claimed();
    await writes.accept(key(1));
    await writes.started(key(2), false);
    await bridge.submissions.updateOne(
      { _id: id },
      {
        $set: {
          cases: Array.from({ length: 9999 }, (_unused, index) =>
            reported(index + 1),
          ),
        },
      },
    );
    expect(await writes.cases(key(3), [reported(10000), reported(10001)])).toBe(
      'full',
    );
    expect(await writes.cases(key(3), [])).toBe('applied');
    expect(await writes.cases(key(4), [reported(10000)])).toBe('applied');
    expect((await stored(id)).cases).toHaveLength(10000);
  });

  it('ends a run as CE with its log, IE with its message, or AB without points', async () => {
    const ce = await claimed();
    await writes.accept(ce.key(1));
    expect(
      (
        await writes.finishWith(ce.key(2), 'CE', {
          log: 'error: x',
          dataVersionUsed: 3,
        })
      ).outcome,
    ).toBe('applied');
    expect(await stored(ce.id)).toMatchObject({
      status: 'CE',
      result: 'CE',
      error: 'error: x',
      judgedDataVersion: 3,
    });
    const ab = await claimed();
    await writes.accept(ab.key(1));
    await writes.started(ab.key(2), false);
    expect(
      (
        await writes.finishWith(ab.key(3), 'AB', {
          log: '',
          dataVersionUsed: 0,
        })
      ).outcome,
    ).toBe('applied');
    expect(await stored(ab.id)).toMatchObject({
      status: 'AB',
      result: 'AB',
      points: 0,
    });
    expect(
      (
        await writes.finishWith(ab.key(4), 'IE', {
          log: 'late',
          dataVersionUsed: 0,
        })
      ).outcome,
    ).toBe('stale');
  });

  it('requeues on RETRY without spending the requeue, and fails the third RETRY as IE', async () => {
    const run = await claimed();
    const retryOnce = async (expectRequeued: boolean) => {
      const [queued] = await repository.loadQueued([run.id]);
      const claim = queued && (await repository.claimRun(queued, JUDGE));
      const ref = claim && 'request' in claim ? claim.request.ref : run.ref;
      const key = { ref, judgeName: JUDGE, seq: 1 };
      await writes.accept(key);
      const outcome = await writes.retry(
        { ...key, seq: 2 },
        'data version 4 not visible',
      );
      expect(outcome).toMatchObject({
        outcome: 'applied',
        requeued: expectRequeued,
      });
    };
    await writes.accept(run.key(1));
    expect(await writes.retry(run.key(2), 'sandbox failed')).toMatchObject({
      outcome: 'applied',
      requeued: true,
    });
    expect(await stored(run.id)).toMatchObject({
      status: 'QU',
      retryCount: 1,
      requeueCount: 0,
      judgedOn: null,
    });
    await retryOnce(true);
    await retryOnce(false);
    expect(await stored(run.id)).toMatchObject({
      status: 'IE',
      retryCount: 3,
      requeueCount: 0,
      judgeGeneration: 3,
      error: `${RETRY_LIMIT_MESSAGE}: data version 4 not visible`,
    });
  });

  it('requeues a refusal without spending a RETRY, keeps it from that judge build until a data save, and re-acks its replay', async () => {
    const run = await claimed();
    const refusing = { name: JUDGE, build: 'v1', dataVersion: 0 };
    let key = run.key(2);
    for (let refusal = 0; refusal < 3; refusal += 1) {
      const [queued] = await repository.loadQueued([run.id]);
      const claim = refusal && (await repository.claimRun(queued, JUDGE));
      if (claim && 'request' in claim)
        key = { ref: claim.request.ref, judgeName: JUDGE, seq: 2 };
      await writes.accept({ ...key, seq: 1 });
      expect(await writes.refuse(key, refusing)).toMatchObject({
        outcome: 'applied',
      });
    }
    expect(await stored(run.id)).toMatchObject({
      status: 'QU',
      retryCount: 0,
      refusedBy: [refusing],
      judgedOn: null,
    });
    expect((await writes.refuse(key, refusing)).outcome).toBe('duplicate');
    const [queued] = await repository.loadQueued([run.id]);
    expect(queued.refusedBy).toEqual([refusing]);
    const judge = Object.assign(new RecordingJudge(JUDGE), { build: 'v1' });
    expect(canJudge(judge, queued)).toBe(false);
    // the author fixes the data: the refusal was made against the old version
    const { problem } = await stored(run.id);
    await bridge.problems.updateOne(
      { _id: problem },
      { $inc: { dataVersion: 1 } },
    );
    const [fixed] = await repository.loadQueued([run.id]);
    expect(canJudge(judge, fixed)).toBe(true);
    // a judge with no stamp in the data dir reports 0: the version its Assign carried is recorded
    const assigned = (await runs.claim(fixed, JUDGE))!;
    runs.sent(assigned);
    const unstamped = { ref: assigned.request.ref, judgeName: JUDGE, seq: 2 };
    await writes.accept({ ...unstamped, seq: 1 });
    await runs.refused(unstamped, { ...refusing, dataVersion: 0 });
    expect((await stored(run.id)).refusedBy).toContainEqual({
      ...refusing,
      dataVersion: 1,
    });
    const [refusedAgain] = await repository.loadQueued([run.id]);
    const claim = await repository.claimRun(refusedAgain, JUDGE);
    if (!claim || !('request' in claim)) throw new Error('not claimed');
    const retried = { ref: claim.request.ref, judgeName: JUDGE, seq: 1 };
    await writes.accept(retried);
    expect(
      await writes.retry({ ...retried, seq: 2 }, 'sandbox failed'),
    ).toMatchObject({ outcome: 'applied', requeued: true });
    expect(await stored(run.id)).toMatchObject({ status: 'QU', retryCount: 1 });
  });

  it('defers a transient RETRY without spending a RETRY, holds it back, re-acks its replay, and fails it as IE once the deferral window is over', async () => {
    const run = await claimed();
    await writes.accept(run.key(1));
    const first = new Date();
    const data = { reason: 'data', log: 'DataUnavailable' } as const;
    expect(await writes.defer(run.key(2), data, first)).toMatchObject({
      outcome: 'applied',
      requeued: true,
    });
    expect(await stored(run.id)).toMatchObject({
      status: 'QU',
      retryCount: 0,
      judgedOn: null,
      deferral: { reason: 'data', since: first, count: 1 },
    });
    expect((await writes.defer(run.key(2), data, first)).outcome).toBe(
      'duplicate',
    );
    const [queued] = await repository.loadQueued([run.id]);
    expect(queued).toMatchObject({
      waitsForData: true,
      retryAfter: first.getTime() + FAST_TIMINGS.deferralBackoffMs,
    });
    const claim = await repository.claimRun(queued, JUDGE);
    if (!claim || !('request' in claim)) throw new Error('not claimed');
    const again = { ref: claim.request.ref, judgeName: JUDGE, seq: 1 };
    await writes.accept(again);
    const late = new Date(first.getTime() + FAST_TIMINGS.deferralWindowMs);
    expect(
      await writes.defer(
        { ...again, seq: 2 },
        { reason: 'sandbox', log: 'SandboxFailure' },
        late,
      ),
    ).toMatchObject({ outcome: 'applied', requeued: false });
    expect(await stored(run.id)).toMatchObject({
      status: 'IE',
      result: 'IE',
      retryCount: 0,
      error: `${DEFERRAL_LIMIT_MESSAGE.sandbox}: SandboxFailure`,
    });
  });

  it('starts a transient wait over on a requeue for another cause: a later transient RETRY waits again instead of ending IE at once', async () => {
    const run = await claimed();
    await writes.accept(run.key(1));
    const first = new Date();
    const data = { reason: 'data', log: 'DataUnavailable' } as const;
    await writes.defer(run.key(2), data, first);
    const reclaim = async () => {
      const [queued] = await repository.loadQueued([run.id]);
      const claim = await repository.claimRun(queued, JUDGE);
      if (!claim || !('request' in claim)) throw new Error('not claimed');
      return { ref: claim.request.ref, judgeName: JUDGE, seq: 1 };
    };
    const lost = await reclaim();
    await writes.accept(lost);
    // its judge was lost and the grace expired
    expect(await repository.requeueRun(lost.ref, JUDGE)).not.toBeNull();
    expect(await stored(run.id)).toMatchObject({
      status: 'QU',
      deferral: null,
    });
    const [queued] = await repository.loadQueued([run.id]);
    expect(queued).toMatchObject({ waitsForData: false, retryAfter: 0 });
    const again = await reclaim();
    await writes.accept(again);
    const late = new Date(first.getTime() + FAST_TIMINGS.deferralWindowMs);
    expect(await writes.defer({ ...again, seq: 2 }, data, late)).toMatchObject({
      outcome: 'applied',
      requeued: true,
    });
    expect(await stored(run.id)).toMatchObject({
      status: 'QU',
      deferral: { since: late, count: 1 },
    });
  });

  it('counts a row without retryCount (a migrated one) as zero RETRYs', async () => {
    const { id, key } = await claimed();
    await writes.accept(key(1));
    await bridge.submissions.updateOne(
      { _id: id },
      { $unset: { retryCount: '' } },
    );
    expect(await stored(id)).not.toHaveProperty('retryCount');
    expect(await writes.retry(key(2), 'sandbox failed')).toMatchObject({
      outcome: 'applied',
      requeued: true,
    });
    expect(await stored(id)).toMatchObject({ status: 'QU', retryCount: 1 });
  });
});
