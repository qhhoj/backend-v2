import type { User } from '@libs/database';
import type { SubmissionListItemResponse } from '../src/modules/submissions/core/dto/submission-list.response';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('best submissions per contest problem', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const roles: Array<[string, Partial<User>]> = [
    ['alice', {}],
    ['bob', {}],
    ['carol', {}],
    ['author', { permissions: ['judge.edit_own_contest'] }],
  ];

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterAll(() => api.teardown());

  const bestUrl = (key: string, code: string) =>
    contestUrl(key, `/problems/${code}/best-submissions`);
  const get = (path: string, who?: string) =>
    who ? authed(api.http().get(path), sessions[who]) : api.http().get(path);
  const rowsOf = (response: { body: unknown }) =>
    dataOf<SubmissionListItemResponse[]>(response).map((item) => item.id);

  /** An ended contest (open to everyone) with one problem. */
  const endedScene = async (code: string, contestExtra = {}) => {
    const problem = await createProblem(api, catalog, { code });
    const contest = await createContest(api, {
      formatName: 'icpc',
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      authors: [users.author._id],
      problems: [contestProblem(problem._id, 0)],
      ...contestExtra,
    });
    const submit = (who: string, fields: Record<string, unknown>) =>
      seedSubmission(api, {
        user: users[who]._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        contest: contest._id,
        points: 100,
        time: 1,
        memory: 1000,
        date: hoursFromNow(-3),
        ...fields,
      }).then((row) => row._id);
    return { contest, problem, submit };
  };

  it('ranks by points, then time, memory and submission time, one row per user, contest submissions only', async () => {
    const { contest, problem, submit } = await endedScene('best_order_p');
    const slowest = await submit('alice', { points: 100, time: 3 });
    // Alice's own better attempts replace her slower one.
    const aliceBest = await submit('alice', { points: 100, time: 0.5 });
    const lessMemory = await submit('bob', {
      points: 100,
      time: 0.5,
      memory: 500,
    });
    const earlier = await submit('carol', {
      points: 100,
      time: 0.5,
      memory: 500,
      date: hoursFromNow(-4),
    });
    const lowPoints = await submit('author', { points: 40, time: 0.1 });
    const outside = (
      await seedSubmission(api, {
        user: users.bob._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        points: 100,
        time: 0.01,
        memory: 1,
      })
    )._id;
    const rows = rowsOf(
      await get(bestUrl(contest.key, problem.code)).expect(200),
    );
    expect(rows).toEqual([earlier, lessMemory, aliceBest, lowPoints]);
    expect(rows).not.toContain(slowest);
    expect(rows).not.toContain(outside);
  });

  it('stops at the freeze for viewers of a frozen board, and lets editors see everything', async () => {
    const { contest, problem, submit } = await endedScene('best_frozen_p', {
      frozenLastMinutes: 180,
    });
    const beforeFreeze = await submit('alice', {
      points: 50,
      date: hoursFromNow(-4.5),
    });
    const afterFreeze = await submit('bob', {
      points: 100,
      date: hoursFromNow(-2),
    });
    const url = bestUrl(contest.key, problem.code);
    expect(rowsOf(await get(url, 'carol').expect(200))).toEqual([beforeFreeze]);
    expect(rowsOf(await get(url).expect(200))).toEqual([beforeFreeze]);
    expect(rowsOf(await get(url, 'author').expect(200))).toEqual([
      afterFreeze,
      beforeFreeze,
    ]);
    const detail = await get(contestUrl(contest.key), 'carol').expect(200);
    expect(
      dataOf<{ viewer: { boardFrozenAt: string | null } }>(detail).viewer
        .boardFrozenAt,
    ).not.toBeNull();
  });

  it('opens a hidden ranking only to the contest editors, and says so in the viewer flags', async () => {
    const { contest, problem, submit } = await endedScene('best_hidden_p', {
      scoreboardVisibility: 'H',
    });
    const row = await submit('alice', {});
    const url = bestUrl(contest.key, problem.code);
    await get(url, 'alice').expect(403).expect(errorCode('forbidden'));
    await get(url).expect(403);
    expect(rowsOf(await get(url, 'author').expect(200))).toEqual([row]);
    const flag = async (who: string) =>
      dataOf<{ viewer: { canSeeFullScoreboard: boolean } }>(
        await get(contestUrl(contest.key), who).expect(200),
      ).viewer.canSeeFullScoreboard;
    expect(await flag('alice')).toBe(false);
    expect(await flag('author')).toBe(true);
  });

  it('answers 404 for a problem the contest does not have', async () => {
    const { contest } = await endedScene('best_member_p');
    await createProblem(api, catalog, { code: 'best_stranger_p' });
    await get(bestUrl(contest.key, 'best_stranger_p'), 'alice')
      .expect(404)
      .expect(errorCode('not_found'));
  });
});
