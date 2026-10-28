import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { sha256 } from '@libs/auth';
import {
  CONTEST_REPLAY_JOB,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
} from '@libs/contests';
import { Status } from '@libs/judge-proto';
import type { ContestReplayJob } from '@libs/contests';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { AssignmentRef } from '@libs/judge-proto';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
} from '../../api/test/contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from '../../api/test/problem-fixtures';
import type { Catalog, TestSession } from '../../api/test/problem-fixtures';
import { dataOf } from '../../api/test/submission-fixtures';
import { setupApiTest } from '../../api/test/setup';
import type { ApiTest } from '../../api/test/setup';
import type { RankingResponse } from '../../api/src/modules/contests/ranking/dto/ranking.response';
import {
  EFFECTS_DUE_GRACE_MS,
  EffectsSweepService,
} from '../../worker/src/jobs/effects-sweep/effects-sweep.service';
import { WorkerModule } from '../../worker/src/worker.module';
import { BridgeModule } from '../src/bridge.module';
import { BRIDGE_TIMINGS } from '../src/bridge-timings';
import { JudgeLinkServer } from '../src/link/judge-link.server';
import { FakeJudge } from './fake-judge';
import { waitUntil } from './fixtures';
import { FAST_TIMINGS } from './setup';

const KEY = 'contest flow key';
const DISQUALIFIED_SCORE = -9999;

/** The real api, bridge and worker on one Mongo and Redis, with a fake judge: grading reaches the participation and both boards, the freeze holds across lists, disqualify survives a rescore, and final_submission rows are judged once at the end. */
describe('a contest across the api, the bridge and the worker', () => {
  let api: ApiTest;
  let bridge: TestingModule;
  let worker: TestingModule;
  let catalog: Catalog;
  let judge: FakeJudge;
  let rescores: Queue;
  let replays: Queue<ContestReplayJob>;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const post = (who: string, path: string, body: object = {}) =>
    authed(api.http().post(path), sessions[who]).send(body);
  const get = (path: string, who?: string) =>
    who ? authed(api.http().get(path), sessions[who]) : api.http().get(path);

  const submit = async (who: string) =>
    dataOf<{ id: string }>(
      await post(who, '/api/internal/problems/xflow/submit', {
        language: catalog.languages.cpp,
        source: 'int main() {}',
      }).expect(201),
    ).id;
  /** The run each requested id is on. */
  const refs = new Map<string, AssignmentRef>();
  const requestedId = async () => {
    const ref = (await judge.nextAssign()).ref!;
    refs.set(ref.submissionId, ref);
    return ref.submissionId;
  };
  const gradeAc = (id: string) =>
    judge.grade(refs.get(id)!, [
      {
        position: 1,
        status: Status.STATUS_AC,
        timeS: 0.01,
        memoryKib: 1024,
        points: 1,
        total: 1,
      },
    ]);
  const requestsFor = (id: string) =>
    judge
      .seen('assign')
      .filter(({ assign }) => assign.ref?.submissionId === id);
  const ranking = async (key: string, who?: string) =>
    dataOf<RankingResponse>(
      await get(contestUrl(key, '/ranking'), who).expect(200),
    );
  const rowOf = (board: RankingResponse, username: string) =>
    board.rows.find((row) => row.user.username === username)!;
  const rescored = () =>
    waitUntil(
      async () =>
        (await rescores.getJobs(['waiting', 'active', 'delayed'])).length === 0,
    );

  beforeAll(async () => {
    api = await setupApiTest();
    Object.assign(process.env, {
      JUDGE_BRIDGE_HOST: '127.0.0.1',
      JUDGE_BRIDGE_PORT: '0',
    });
    catalog = await seedCatalog(api);
    const roles: Array<[string, object]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['alice', { permissions: ['judge.spam_submission'] }],
      ['bob', { permissions: ['judge.spam_submission'] }],
      ['dana', { permissions: ['judge.spam_submission'] }],
      ['erin', { permissions: ['judge.spam_submission'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    await api.judges.create({ name: 'judge-flow', authKeyHash: sha256(KEY) });
    bridge = await Test.createTestingModule({ imports: [BridgeModule] })
      .overrideProvider(BRIDGE_TIMINGS)
      .useValue(FAST_TIMINGS)
      .compile();
    await bridge.init();
    worker = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await worker.init();
    // Online only now: a stall while the worker boots would otherwise idle the judge out.
    judge = await FakeJudge.online(bridge.get(JudgeLinkServer).port(), {
      name: 'judge-flow',
      key: KEY,
    });
    rescores = api.app.get(getQueueToken(CONTEST_RESCORE_QUEUE));
    replays = api.app.get(getQueueToken(CONTEST_REPLAY_QUEUE));
  });
  afterAll(async () => {
    await judge?.close();
    await worker?.close();
    await bridge?.close();
    await api.teardown();
  });

  it('keeps the frozen board and submission lists frozen for contestants while grading and disqualification reach the editor board', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'xflow',
      partial: true,
    });
    const contest = await createContest(api, {
      formatName: 'icpc',
      authors: [users.editor._id],
      endTime: hoursFromNow(1),
      frozenLastMinutes: 120,
      rules: 'No outside help.',
      rulesRevision: 3,
      problems: [contestProblem(problem._id, 0)],
    });
    const refused = await post(
      'alice',
      contestUrl(contest.key, '/join'),
    ).expect(400);
    expect((refused.body as { error: { code: string } }).error.code).toBe(
      'rules_not_accepted',
    );
    expect(
      await api.participations.countDocuments({ contest: contest._id }),
    ).toBe(0);
    for (const who of ['alice', 'bob'])
      await post(who, contestUrl(contest.key, '/join'), {
        acceptRules: true,
        acceptRulesRevision: 3,
      }).expect(201);
    expect(
      await api.participations.findOne({
        contest: contest._id,
        user: users.alice._id,
      }),
    ).toMatchObject({ rulesAcceptedRevision: 3 });

    const aliceSubmission = await submit('alice');
    expect(await requestedId()).toBe(aliceSubmission);
    expect(
      await api.submissions.findById(aliceSubmission).lean(),
    ).toMatchObject({ priority: 0 });
    await gradeAc(aliceSubmission);
    await waitUntil(
      async () =>
        rowOf(await ranking(contest.key, 'editor'), 'alice').score > 0,
    );

    const live = await ranking(contest.key, 'editor');
    expect(live.frozen).toBe(false);
    expect(rowOf(live, 'alice')).toMatchObject({ rank: 1 });
    for (const who of ['bob', undefined]) {
      const frozen = await ranking(contest.key, who);
      expect(frozen.frozen).toBe(true);
      expect(rowOf(frozen, 'alice').score).toBe(0);
    }

    const listing = '/api/internal/submissions?problem=xflow';
    const idsFor = async (who?: string) =>
      dataOf<Array<{ id: string }>>(await get(listing, who).expect(200)).map(
        (item) => item.id,
      );
    expect(await idsFor('alice')).toContain(aliceSubmission);
    expect(await idsFor('bob')).not.toContain(aliceSubmission);
    expect(await idsFor()).not.toContain(aliceSubmission);
    await get(`/api/internal/submissions/${aliceSubmission}`, 'bob').expect(
      403,
    );

    const aliceParticipation = (await api.participations.findOne({
      contest: contest._id,
      user: users.alice._id,
    }))!._id;
    await post(
      'editor',
      contestUrl(
        contest.key,
        `/participations/${aliceParticipation}/disqualify`,
      ),
      { disqualified: true },
    ).expect(201);
    await post('editor', contestUrl(contest.key, '/rescore')).expect(202);
    await rescored();
    const after = await ranking(contest.key, 'editor');
    expect(rowOf(after, 'alice')).toMatchObject({
      isDisqualified: true,
      score: DISQUALIFIED_SCORE,
    });
    expect(after.rows.at(-1)!.user.username).toBe('alice');
    // the rescore queues one replay build, held until the judge settles after the end
    const builds = (
      await replays.getJobs(['waiting', 'active', 'delayed', 'completed'])
    ).filter((job) => job.data.contestId === contest._id);
    expect(builds).toHaveLength(1);
    expect(builds[0].name).toBe(CONTEST_REPLAY_JOB);
  });

  it('holds final_submission rows pending, then judges each unrejected row exactly once after the end', async () => {
    const problem = (await api.problems.findOne({ code: 'xflow' }))!;
    const contest = await createContest(api, {
      formatName: 'final_submission',
      authors: [users.editor._id],
      problems: [contestProblem(problem._id, 0)],
    });
    await post('dana', contestUrl(contest.key, '/join')).expect(201);
    const pending = await submit('dana');
    expect(await api.submissions.findById(pending).lean()).toMatchObject({
      status: 'PD',
    });
    expect(requestsFor(pending)).toEqual([]);

    await api.contests.updateOne(
      { _id: contest._id },
      { startTime: hoursFromNow(-5), endTime: hoursFromNow(-1) },
    );
    await post('editor', contestUrl(contest.key, '/judge-final')).expect(202);
    await post('editor', contestUrl(contest.key, '/judge-final')).expect(202);
    expect(await requestedId()).toBe(pending);
    await gradeAc(pending);
    await waitUntil(
      async () => rowOf(await ranking(contest.key, 'editor'), 'dana').score > 0,
    );
    // `next` consumed the one request; a second judge-final must not have queued another.
    expect(requestsFor(pending)).toEqual([]);
  });

  it('repairs the board and the user points when the bridge dies between the Final write and the graded job', async () => {
    const problem = (await api.problems.findOne({ code: 'xflow' }))!;
    const contest = await createContest(api, {
      formatName: 'ioi',
      authors: [users.editor._id],
      problems: [contestProblem(problem._id, 0)],
    });
    await post('erin', contestUrl(contest.key, '/join')).expect(201);
    const graded = bridge.get<Queue>(getQueueToken(SUBMISSION_GRADED_QUEUE));
    // the process is gone before the enqueue reaches Redis; the judge's resend after the restart is dropped (the row is no longer P/G)
    const crash = jest
      .spyOn(graded, 'add')
      .mockRejectedValueOnce(new Error('bridge crashed'));
    const id = await submit('erin');
    expect(await requestedId()).toBe(id);
    try {
      await gradeAc(id);
      expect(crash).toHaveBeenCalledTimes(1);
    } finally {
      crash.mockRestore();
    }
    const state = async () => ({
      score: rowOf(await ranking(contest.key, 'editor'), 'erin').score,
      userPoints: (await api.users.findById(users.erin._id).lean())!.points,
      effectsDue: !!(await api.submissions.findById(id).lean())!.effectsDueAt,
    });
    expect(await api.submissions.findById(id).lean()).toMatchObject({
      status: 'D',
      result: 'AC',
    });
    expect(await state()).toEqual({
      score: 0,
      userPoints: 0,
      effectsDue: true,
    });

    await worker
      .get(EffectsSweepService)
      .sweep(Date.now() + EFFECTS_DUE_GRACE_MS);
    expect(await state()).toEqual({
      score: 100,
      userPoints: 1000,
      effectsDue: false,
    });
  });
});
