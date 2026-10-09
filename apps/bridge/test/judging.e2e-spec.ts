import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { sha256 } from '@libs/auth';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { Outcome, Status } from '@libs/judge-proto';
import type { AssignmentRef, Case } from '@libs/judge-proto';
import {
  authed,
  createProblem,
  createUserWith,
  detailOf,
  loginAs,
  seedCatalog,
} from '../../api/test/problem-fixtures';
import type { Catalog, TestSession } from '../../api/test/problem-fixtures';
import { softDelete } from '../../api/test/deleted-problem-fixtures';
import { dataOf } from '../../api/test/submission-fixtures';
import { setupApiTest } from '../../api/test/setup';
import type { ApiTest } from '../../api/test/setup';
import { WorkerModule } from '../../worker/src/worker.module';
import { openStream } from '../../api/test/sse-client';
import { BridgeModule } from '../src/bridge.module';
import { BRIDGE_TIMINGS } from '../src/bridge-timings';
import { JudgeLinkServer } from '../src/link/judge-link.server';
import { FakeJudge } from './fake-judge';
import { waitUntil } from './fixtures';
import { countResyncTicks, resyncTicks } from './resync-ticks';
import { FAST_TIMINGS } from './setup';

const SUBMISSIONS = '/api/internal/submissions';
const KEY = 'judging key';
const caseOf = (position: number, status: Status): Partial<Case> => ({
  position,
  status,
  timeS: 0.01,
  memoryKib: 1024,
  points: status === Status.STATUS_AC ? 1 : 0,
  total: 1,
  outputPrefix: 'secret output',
});

/** The real api and the real bridge on one Mongo and one Redis, with a fake judge over gRPC: the flows no single app's suite sees. */
describe('judging across the api and the bridge', () => {
  let api: ApiTest;
  let bridge: TestingModule;
  let catalog: Catalog;
  let judge: FakeJudge;
  let graded: Queue<SubmissionGradedJob>;
  const sessions: Record<string, TestSession> = {};

  const submit = async (code = 'xapp') =>
    dataOf<{ id: string }>(
      await authed(
        api.http().post(`/api/internal/problems/${code}/submit`),
        sessions.owner,
      )
        .send({ language: catalog.languages.cpp, source: 'int main() {}' })
        .expect(201),
    ).id;
  const act = (who: string, id: string, action: string) =>
    authed(api.http().post(`${SUBMISSIONS}/${id}/${action}`), sessions[who]);
  const row = async (id: string) =>
    (await api.submissions.findById(id).select('+cases').lean())!;
  const detail = async (id: string) =>
    dataOf<{ status: string; result: string | null; cases: object[] | null }>(
      await authed(
        api.http().get(`${SUBMISSIONS}/${id}`),
        sessions.owner,
      ).expect(200),
    );
  const gradedJobsOf = async (id: string) =>
    (
      await graded.getJobs(['waiting', 'active', 'delayed', 'completed'])
    ).filter((job) => job.data.submissionId === id);
  /** The next Assign's ref; `refs` remembers the run each id is on. */
  const refs = new Map<string, AssignmentRef>();
  const requestedId = async () => {
    const ref = (await judge.nextAssign()).ref!;
    refs.set(ref.submissionId, ref);
    return ref.submissionId;
  };
  const begin = (id: string) => {
    judge.accept(refs.get(id)!);
    judge.started(refs.get(id)!, 2);
  };
  const gradeAcWa = (id: string) => {
    judge.cases(refs.get(id)!, [
      caseOf(1, Status.STATUS_AC),
      caseOf(2, Status.STATUS_WA),
    ]);
    judge.final(refs.get(id)!, Outcome.OUTCOME_GRADED);
  };
  const finished = (id: string, status: string) =>
    waitUntil(async () => (await row(id)).status === status);

  beforeAll(async () => {
    countResyncTicks();
    api = await setupApiTest();
    Object.assign(process.env, {
      JUDGE_BRIDGE_HOST: '127.0.0.1',
      JUDGE_BRIDGE_PORT: '0',
    });
    catalog = await seedCatalog(api);
    const owner = await createUserWith(api, 'owner', {
      permissions: ['judge.spam_submission'],
    });
    const manager = await createUserWith(api, 'manager', {
      permissions: [
        'judge.edit_own_problem',
        'judge.rejudge_submission',
        'judge.reject_submission',
      ],
    });
    // a deleted problem's submissions are visible only to staff with view_all_submission
    const staff = await createUserWith(api, 'staff', {
      permissions: [
        'judge.view_all_submission',
        'judge.edit_own_problem',
        'judge.edit_all_problem',
        'judge.rejudge_submission',
        'judge.reject_submission',
      ],
    });
    sessions.staff = await loginAs(api, staff._id);
    sessions.owner = await loginAs(api, owner._id);
    sessions.manager = await loginAs(api, manager._id);
    await createProblem(api, catalog, {
      code: 'xapp',
      authors: [manager._id],
      partial: true,
      testcaseVisibility: 'O',
    });
    await createProblem(api, catalog, {
      code: 'xdel',
      authors: [manager._id],
      partial: true,
    });
    await api.judges.create({ name: 'judge-x', authKeyHash: sha256(KEY) });
    bridge = await Test.createTestingModule({ imports: [BridgeModule] })
      .overrideProvider(BRIDGE_TIMINGS)
      .useValue({ ...FAST_TIMINGS, resyncMs: 300 })
      .compile();
    await bridge.init();
    graded = api.app.get(getQueueToken(SUBMISSION_GRADED_QUEUE));
    judge = await FakeJudge.online(bridge.get(JudgeLinkServer).port(), {
      name: 'judge-x',
      key: KEY,
    });
  });
  afterAll(async () => {
    await judge?.close();
    await bridge?.close();
    await api.teardown();
    jest.restoreAllMocks();
  });

  it('dispatches a submit, grades it to D and enqueues exactly one graded job', async () => {
    const id = await submit();
    expect(await requestedId()).toBe(id);
    begin(id);
    gradeAcWa(id);
    await finished(id, 'D');
    expect(await row(id)).toMatchObject({
      result: 'WA',
      casePoints: 1,
      caseTotal: 2,
      points: 500,
      judgedOn: 'judge-x',
    });
    const shown = await detail(id);
    expect(shown).toMatchObject({ status: 'D', result: 'WA' });
    expect(shown.cases).toMatchObject([{ status: 'AC' }, { status: 'WA' }]);
    expect(JSON.stringify(shown.cases)).not.toContain('secret output');
    expect(await gradedJobsOf(id)).toHaveLength(1);
  });

  it('aborts a running submission through the judge: AB, graded once', async () => {
    const id = await submit();
    expect(await requestedId()).toBe(id);
    begin(id);
    await finished(id, 'G');
    await act('owner', id, 'abort').expect(204);
    expect((await judge.next('abort')).abort.ref).toEqual(refs.get(id));
    judge.final(refs.get(id)!, Outcome.OUTCOME_ABORTED);
    await finished(id, 'AB');
    expect(await row(id)).toMatchObject({ result: 'AB', points: 0 });
    expect(await detail(id)).toMatchObject({ status: 'AB' });
    expect(await gradedJobsOf(id)).toHaveLength(1);
  });

  it('aborts a queued submission at once and never dispatches it', async () => {
    const running = await submit();
    expect(await requestedId()).toBe(running);
    begin(running);
    const queued = await submit();
    await act('owner', queued, 'abort').expect(204);
    expect(await row(queued)).toMatchObject({ status: 'AB' });
    expect(await gradedJobsOf(queued)).toHaveLength(1);
    gradeAcWa(running);
    await finished(running, 'D');
    // two resync ticks: the aborted row must not come back
    await resyncTicks(2);
    expect(judge.seen('assign')).toEqual([]);
    expect(await row(queued)).toMatchObject({ status: 'AB', judgedOn: null });
  });

  it('rejudges a finished submission, grades it again and rejects it', async () => {
    const id = await submit();
    expect(await requestedId()).toBe(id);
    begin(id);
    gradeAcWa(id);
    await finished(id, 'D');
    await act('manager', id, 'rejudge').expect(204);
    expect(await requestedId()).toBe(id);
    expect(refs.get(id)?.generation).toBe(2);
    begin(id);
    judge.cases(refs.get(id)!, [
      caseOf(1, Status.STATUS_AC),
      caseOf(2, Status.STATUS_AC),
    ]);
    judge.final(refs.get(id)!, Outcome.OUTCOME_GRADED);
    await waitUntil(async () => (await row(id)).result === 'AC');
    expect(await row(id)).toMatchObject({ status: 'D', points: 1000 });
    await waitUntil(async () => (await gradedJobsOf(id)).length === 2);
    await act('manager', id, 'reject').expect(204);
    expect(await row(id)).toMatchObject({
      status: 'D',
      result: 'RJ',
      points: 0,
      cases: [],
    });
    expect(await detail(id)).toMatchObject({ status: 'D', result: 'RJ' });
    expect(await gradedJobsOf(id)).toHaveLength(3);
  });
  it('still judges a run queued before its problem was deleted, then refuses to rejudge or reject it with 409 problem_deleted', async () => {
    const running = await submit();
    expect(await requestedId()).toBe(running);
    begin(running);
    const queued = await submit('xdel');
    await softDelete(api, (await api.problems.findOne({ code: 'xdel' }))!._id);
    gradeAcWa(running);
    await finished(running, 'D');
    expect(await requestedId()).toBe(queued);
    begin(queued);
    gradeAcWa(queued);
    await finished(queued, 'D');
    expect(await row(queued)).toMatchObject({
      result: 'WA',
      judgedOn: 'judge-x',
    });
    for (const action of ['rejudge', 'reject']) {
      const refused = await act('staff', queued, action).expect(409);
      expect((refused.body as { error: { code: string } }).error.code).toBe(
        'problem_deleted',
      );
    }
    expect(await row(queued)).toMatchObject({ status: 'D', result: 'WA' });
    expect(judge.seen('assign')).toEqual([]);
    expect(await gradedJobsOf(queued)).toHaveLength(1);
  });

  describe('with the worker', () => {
    let worker: TestingModule;
    let solverJudge: FakeJudge;
    let solver: TestSession;
    const FLOW_PROBLEM = '/api/internal/problems/xflow';
    const viewerStatus = async () =>
      detailOf(await authed(api.http().get(FLOW_PROBLEM), solver).expect(200))
        .viewerStatus;

    beforeAll(async () => {
      const author = await createUserWith(api, 'flow-author', {
        permissions: ['judge.edit_own_problem'],
      });
      sessions.author = await loginAs(api, author._id);
      solver = await loginAs(
        api,
        (
          await createUserWith(api, 'solver', {
            permissions: ['judge.spam_submission'],
          })
        )._id,
      );
      await createProblem(api, catalog, {
        code: 'xflow',
        authors: [author._id],
        partial: true,
        testcaseResultVisibility: 'A',
      });
      await api.judges.create({ name: 'judge-y', authKeyHash: sha256(KEY) });
      worker = await Test.createTestingModule({
        imports: [WorkerModule],
      }).compile();
      await worker.init();
      // every judge sees every problem: judge-x leaves so the flow's submission reaches judge-y
      await judge.close();
      // Online only now: a stall while the worker boots would otherwise idle the judge out.
      solverJudge = await FakeJudge.online(bridge.get(JudgeLinkServer).port(), {
        name: 'judge-y',
        key: KEY,
      });
    });
    afterAll(async () => {
      await solverJudge?.close();
      await worker?.close();
    });

    it('grades to AC, streams the events, updates points, stats and viewerStatus, and follows a points edit', async () => {
      expect(await viewerStatus()).toBeNull();
      const { id } = dataOf<{ id: string }>(
        await authed(
          api.http().post('/api/internal/problems/xflow/submit'),
          solver,
        )
          .send({ language: catalog.languages.cpp, source: 'int main() {}' })
          .expect(201),
      );
      const stream = await openStream(
        api,
        `/api/internal/events/submissions/${id}`,
        { Cookie: solver.cookie },
      );
      try {
        expect(stream.status).toBe(200);
        await stream.next('state');
        const ref = (await solverJudge.nextAssign()).ref!;
        expect(ref.submissionId).toBe(id);
        await solverJudge.grade(ref, [
          caseOf(1, Status.STATUS_AC),
          caseOf(2, Status.STATUS_AC),
        ]);
        await waitUntil(() =>
          stream.messages.some((message) => message.event === 'done'),
        );
        const events = stream.messages.map((message) => message.event);
        expect(events.slice(events.indexOf('grading-begin'))).toEqual([
          'grading-begin',
          'test-case',
          'done',
        ]);
        expect(stream.messages.at(-1)?.data).toMatchObject({ status: 'D' });
      } finally {
        stream.close();
      }
      // the worker's effects: points, problem stats and the viewer's mark follow the AC
      await waitUntil(
        async () =>
          (await api.users.findOne({ username: 'solver' }))?.points === 1000,
      );
      await waitUntil(
        async () =>
          (await api.problems.findOne({ code: 'xflow' }))?.userCount === 1,
      );
      expect(await row(id)).toMatchObject({ result: 'AC', points: 1000 });
      expect(await viewerStatus()).toBe('solved');
      // a points edit rescores the submission and the user
      await authed(api.http().patch(FLOW_PROBLEM), sessions.author)
        .send({ points: 1200 })
        .expect(200);
      await waitUntil(
        async () =>
          (await api.users.findOne({ username: 'solver' }))?.points === 1200,
      );
      expect(await row(id)).toMatchObject({ points: 1200 });
      expect(await viewerStatus()).toBe('solved');
    });
  });
});
