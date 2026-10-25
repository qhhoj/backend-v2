import type {
  ActivityResponse,
  SolvedResponse,
} from '../src/modules/users/pages/dto/user-page.response';
import type { ProblemListItemResponse } from '../src/modules/problems/core/dto/problem-list.response';
import {
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  detailOf,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

let api: ApiTest;
let catalog: Catalog;

beforeAll(async () => {
  api = await setupApiTest();
  await api.reset();
  catalog = await seedCatalog(api);
});
afterAll(() => api.teardown());

describe('P2-1 contest hideProblemTags / hideProblemAuthors', () => {
  it('blanks types and authors of a contest problem in detail and list for a contestant', async () => {
    const setter = await createUserWith(api, 'setter', {});
    const racer = await createUserWith(api, 'racer21', {});
    const problem = await createProblem(api, catalog, {
      code: 'hidetags',
      isPublic: false,
      typeIds: [catalog.types.dp],
      authors: [setter._id],
    });
    const contest = await createContest(api, {
      key: 'hide_round',
      hideProblemTags: true,
      hideProblemAuthors: true,
      problems: [contestProblem(problem._id, 0)],
    });
    const participation = await joinParticipation(api, contest._id, racer._id);
    await makeCurrent(api, racer._id, participation._id);
    const session = await loginAs(api, racer._id);

    const detail = detailOf(
      await authed(
        api.http().get('/api/internal/problems/hidetags'),
        session,
      ).expect(200),
    );
    expect(detail.contest?.contestKey).toBe('hide_round');
    // Intended behaviour: both empty while the viewer is in a contest that hides them.
    expect({
      types: detail.types.map((type) => type.id),
      authors: detail.authors.map((author) => author.username),
    }).toEqual({ types: [], authors: [] });
    const list = await authed(
      api.http().get('/api/internal/problems?visibility=all'),
      session,
    ).expect(200);
    const item = (list.body as { data: ProblemListItemResponse[] }).data.find(
      (row) => row.code === 'hidetags',
    );
    const probe = await authed(
      api
        .http()
        .get(
          `/api/internal/problems?visibility=all&typeIds=${catalog.types.uncategorized}&authorId=${racer._id}`,
        ),
      session,
    ).expect(200);
    // A filter on a tag or author the problem lacks is ignored, so filters cannot probe hidden facts.
    expect(
      (probe.body as { data: ProblemListItemResponse[] }).data.map(
        (row) => row.code,
      ),
    ).toContain('hidetags');
    expect({ types: item?.types, authors: item?.authors }).toEqual({
      types: [],
      authors: [],
    });
  });
});

describe('P3-1 public heatmap', () => {
  it('counts a running, closed-list contest submission that solved leaves out', async () => {
    const racer = await createUserWith(api, 'racer31', {});
    const problem = await createProblem(api, catalog, { code: 'heat31' });
    const contest = await createContest(api, {
      key: 'heat_round',
      showSubmissionList: false,
    });
    await api.submissions.create({
      user: racer._id,
      problem: problem._id,
      language: catalog.languages.cpp,
      status: 'D',
      result: 'AC',
      casePoints: 1,
      caseTotal: 1,
      points: 1000,
      contest: contest._id,
      date: new Date(),
    });
    const solved = dataOf<SolvedResponse>(
      await api.http().get('/api/internal/users/racer31/solved').expect(200),
    );
    const activity = dataOf<ActivityResponse>(
      await api
        .http()
        .get('/api/internal/users/racer31/activity?timezone=UTC')
        .expect(200),
    );
    expect(solved.groups.flatMap((group) => group.problems)).toEqual([]);
    // Intended behaviour: the anonymous heatmap hides it like solved does.
    expect(Object.values(activity.days)).toEqual([]);
  });
});

describe('public heatmap and problem visibility', () => {
  it('counts practice submissions on public problems only, as solved does', async () => {
    const practiser = await createUserWith(api, 'practiser32', {});
    const problems = await Promise.all([
      createProblem(api, catalog, { code: 'heat32_public' }),
      createProblem(api, catalog, { code: 'heat32_private', isPublic: false }),
      createProblem(api, catalog, {
        code: 'heat32_members',
        isOrganizationPrivate: true,
      }),
    ]);
    for (const problem of problems)
      await api.submissions.create({
        user: practiser._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        status: 'D',
        result: 'WA',
        date: new Date(),
      });
    const activity = dataOf<ActivityResponse>(
      await api
        .http()
        .get('/api/internal/users/practiser32/activity?timezone=UTC')
        .expect(200),
    );
    expect(Object.values(activity.days)).toEqual([1]);
  });
});
