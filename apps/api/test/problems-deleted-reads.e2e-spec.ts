import { ContestsRepository } from '../src/modules/contests/core/contests.repository';
import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';
import { contestProblem, contestUrl, createContest } from './contest-fixtures';
import { softDelete, tombstone, undelete } from './deleted-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

const PROBLEMS = '/api/internal/problems';

describe('soft-deleted problems on the read paths', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let root: TestSession;
  let repository: ProblemsRepository;
  let live: { _id: string; code: string };
  let gone: { _id: string; code: string };
  const codesIn = async (query = '') =>
    dataOf<Array<{ code: string }>>(
      await authed(api.http().get(`${PROBLEMS}${query}`), root).expect(200),
    ).map((row) => row.code);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    root = await loginAs(
      api,
      (await createUserWith(api, 'del_root', { isSuperuser: true }))._id,
    );
    repository = api.app.get(ProblemsRepository);
    live = await createProblem(api, catalog, { code: 'del_live' });
    gone = await createProblem(api, catalog, { code: 'del_gone' });
    await softDelete(api, gone._id);
  });
  afterAll(() => api.teardown());

  it('is absent from the list and the search, even for a superuser', async () => {
    const codes = await codesIn();
    expect(codes).toContain(live.code);
    expect(codes).not.toContain(gone.code);
    expect(await codesIn('?search=del_gone')).toEqual([]);
    expect(await codesIn('?search=del_live')).toEqual([live.code]);
  });

  it('answers 404 to the detail, editorial, PDF, data editor and comment page, and 200 for a live problem', async () => {
    const get = (path: string) => authed(api.http().get(path), root);
    await get(`${PROBLEMS}/${live.code}`).expect(200);
    for (const path of [
      `${PROBLEMS}/${gone.code}`,
      `${PROBLEMS}/${gone.code}/editorial`,
      `${PROBLEMS}/${gone.code}/pdf`,
      `${PROBLEMS}/${gone.code}/data`,
      `/api/internal/comments/pages/problem/${gone.code}`,
    ])
      await get(path).expect(404);
  });

  it('keeps the code reserved: a rename onto it is refused', async () => {
    await authed(api.http().patch(`${PROBLEMS}/${live.code}`), root)
      .send({ code: gone.code })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('refuses a deleted problem in the contest editor like any unknown problem', async () => {
    const contest = await createContest(api, { authors: [] });
    await authed(api.http().patch(contestUrl(contest.key)), root)
      .send({ problems: [{ problem: gone._id, points: 100 }] })
      .expect(400);
    await authed(api.http().patch(contestUrl(contest.key)), root)
      .send({ problems: [{ problem: live._id, points: 100 }] })
      .expect(200);
  });

  it('offers named finders that see deleted problems, and only those', async () => {
    expect(await repository.findByCode(gone.code)).toBeNull();
    expect(await repository.findById(gone._id)).toBeNull();
    expect(await repository.findByIds([gone._id, live._id])).toHaveLength(1);
    expect(await repository.idByCode(gone.code)).toBeNull();
    expect(await repository.findDeletedByCode(gone.code)).toMatchObject({
      code: gone.code,
    });
    expect(await repository.findDeletedByCode(live.code)).toBeNull();
    expect((await repository.findIncludingDeleted(gone._id))?.code).toBe(
      gone.code,
    );
    expect((await repository.findIncludingDeleted(live._id))?.code).toBe(
      live.code,
    );
    expect(await repository.findIncludingDeleted('not-an-id')).toBeNull();
    const summaries = await repository.findSummariesIncludingDeleted([
      gone._id,
      live._id,
    ]);
    expect(summaries.map((row) => row.code).sort()).toEqual([
      gone.code,
      live.code,
    ]);
    expect(await repository.deletedIds()).toEqual([gone._id]);
  });

  it('marks a problem deleted once, restores it, and refuses to restore a purged one', async () => {
    const problem = await createProblem(api, catalog, { code: 'del_cycle' });
    const actor = (await createUserWith(api, 'del_actor'))._id;
    expect(await repository.markDeleted(problem._id, actor, new Date())).toBe(
      true,
    );
    expect(await repository.markDeleted(problem._id, actor, new Date())).toBe(
      false,
    );
    expect(await repository.findByCode(problem.code)).toBeNull();
    expect(await repository.restore(problem._id)).toBe(true);
    expect(await repository.restore(problem._id)).toBe(false);
    expect((await repository.findByCode(problem.code))?.code).toBe(
      problem.code,
    );
    await tombstone(api, problem._id);
    expect(await repository.restore(problem._id)).toBe(false);
    await undelete(api, problem._id);
  });

  it('pages the deleted problems newest deletion first, through a visibility filter', async () => {
    await softDelete(api, gone._id, {
      deletedAt: new Date(Date.now() - 10_000),
    });
    const older = await createProblem(api, catalog, { code: 'del_older' });
    const newer = await createProblem(api, catalog, {
      code: 'del_newer',
      isPublic: false,
    });
    await softDelete(api, older._id, {
      deletedAt: new Date(Date.now() - 5000),
    });
    await softDelete(api, newer._id, { deletedAt: new Date(Date.now() - 100) });
    const all = await repository.deletedPage({}, 1, 10);
    expect(all.items.map((row) => row.code)).toEqual([
      'del_newer',
      'del_older',
      'del_gone',
    ]);
    const publicOnly = await repository.deletedPage({ isPublic: true }, 1, 10);
    expect(publicOnly.items.map((row) => row.code)).toEqual([
      'del_older',
      'del_gone',
    ]);
    expect(publicOnly.total).toBe(2);
  });

  it('knows whether any contest holds a problem', async () => {
    const used = await createProblem(api, catalog, { code: 'del_used' });
    const free = await createProblem(api, catalog, { code: 'del_free' });
    await createContest(api, { problems: [contestProblem(used._id, 0)] });
    const contests = api.app.get(ContestsRepository);
    expect(await contests.isProblemInAnyContest(used._id)).toBe(true);
    expect(await contests.isProblemInAnyContest(free._id)).toBe(false);
  });
});
