import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { SimilarityRunsRepository } from '../src/modules/similarity/core/similarity-runs.repository';
import type { HomeResponse } from '../src/modules/home/dto/home.response';
import type {
  PpEntryResponse,
  SolvedResponse,
} from '../src/modules/users/pages/dto/user-page.response';
import { softDelete, undelete } from './deleted-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('deleted problems on home, user pages and similarity', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const solve = (user: string, problem: string) =>
    api.submissions.create({
      user,
      problem,
      language: catalog.languages.cpp,
      status: 'D',
      result: 'AC',
      points: 1000,
      casePoints: 1,
      caseTotal: 1,
    });
  const forgetCachedHome = async () => {
    const redis = api.app.get<Redis>(REDIS);
    const keys = await redis.keys('home:*');
    if (keys.length) await redis.del(...keys);
  };
  const home = async () =>
    dataOf<HomeResponse>(
      await api.http().get('/api/internal/home').expect(200),
    );

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterAll(() => api.teardown());

  it('drops a deleted problem from the newest list and the problem count, and brings it back on restore', async () => {
    const keep = await createProblem(api, catalog, { code: 'rd_home_keep' });
    const drop = await createProblem(api, catalog, { code: 'rd_home_drop' });
    await forgetCachedHome();
    const before = await home();
    expect(before.newProblems.map((row) => row.code)).toEqual(
      expect.arrayContaining([keep.code, drop.code]),
    );
    await softDelete(api, drop._id);
    await forgetCachedHome();
    const during = await home();
    expect(during.newProblems.map((row) => row.code)).not.toContain(drop.code);
    expect(during.newProblems.map((row) => row.code)).toContain(keep.code);
    expect(during.counts.problems).toBe(before.counts.problems - 1);
    await undelete(api, drop._id);
    await forgetCachedHome();
    expect((await home()).counts.problems).toBe(before.counts.problems);
  });

  it('lists only live problems among those a user solved and in the PP breakdown', async () => {
    const solver = await createUserWith(api, 'rd_solver');
    const keep = await createProblem(api, catalog, { code: 'rd_solved_keep' });
    const drop = await createProblem(api, catalog, { code: 'rd_solved_drop' });
    await solve(solver._id, keep._id);
    await solve(solver._id, drop._id);
    await softDelete(api, drop._id);
    const solved = dataOf<SolvedResponse>(
      await api.http().get('/api/internal/users/rd_solver/solved').expect(200),
    );
    expect(
      solved.groups.flatMap((group) => group.problems.map((row) => row.code)),
    ).toEqual([keep.code]);
    const breakdown = dataOf<PpEntryResponse[]>(
      await api
        .http()
        .get('/api/internal/users/rd_solver/pp-breakdown')
        .expect(200),
    );
    expect(breakdown.map((entry) => entry.problem.code)).toEqual([keep.code]);
  });

  it('refuses to start a similarity run on a deleted problem and still names it in the run list', async () => {
    const editor = await createUserWith(api, 'rd_sim', {
      permissions: ['judge.moss_contest', 'judge.edit_own_problem'],
    });
    const session = await loginAs(api, editor._id);
    const problem = await createProblem(api, catalog, {
      code: 'rd_sim_problem',
      authors: [editor._id],
    });
    await softDelete(api, problem._id);
    await authed(api.http().post('/api/internal/similarity/runs'), session)
      .send({ problem: problem.code })
      .expect(404);
    const codes = await api.app
      .get(SimilarityRunsRepository)
      .problemCodes([problem._id]);
    expect(codes.get(problem._id)).toBe(problem.code);
  });
});
