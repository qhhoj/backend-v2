import type { Contest, SubmissionCase } from '@libs/database';
import type { ProblemListItemResponse } from '../src/modules/problems/core/dto/problem-list.response';
import {
  contestProblem,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
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
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest-only problem access', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let session: TestSession;
  let userId: string;
  const problem = (code: string) =>
    authed(api.http().get(`/api/internal/problems/${code}`), session);
  const listedCodes = async () =>
    dataOf<ProblemListItemResponse[]>(
      await authed(
        api.http().get('/api/internal/problems?visibility=all&pageSize=100'),
        session,
      ).expect(200),
    ).map((item) => item.code);
  const enter = async (
    contestId: string,
    extra: Parameters<typeof joinParticipation>[3] = {},
  ) => {
    const participation = await joinParticipation(
      api,
      contestId,
      userId,
      extra,
    );
    await makeCurrent(api, userId, participation._id);
    return participation;
  };
  const submit = (code: string) =>
    authed(
      api.http().post(`/api/internal/problems/${code}/submit`),
      session,
    ).send({ language: catalog.languages.cpp, source: 'int main() {}' });
  const ownSubmissionCount = async () =>
    dataOf<unknown[]>(
      await authed(
        api.http().get('/api/internal/submissions?user=contestant'),
        session,
      ).expect(200),
    ).length;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    userId = (await createUserWith(api, 'contestant'))._id;
    session = await loginAs(api, userId);
  });
  afterAll(() => api.teardown());

  it("shows the current contest's private problems, in detail, list and submission list, and nothing of another contest", async () => {
    const mine = await createProblem(api, catalog, {
      code: 'mine',
      isPublic: false,
    });
    const theirs = await createProblem(api, catalog, {
      code: 'theirs',
      isPublic: false,
    });
    await createProblem(api, catalog, { code: 'everyone' });
    const contest = await createContest(api, {
      problems: [contestProblem(mine._id, 0)],
    });
    await createContest(api, { problems: [contestProblem(theirs._id, 0)] });
    await problem('mine').expect(404);
    await enter(contest._id);
    await problem('mine').expect(200);
    await problem('everyone').expect(200);
    await problem('theirs').expect(404);
    expect(await listedCodes()).toEqual(
      expect.arrayContaining(['mine', 'everyone']),
    );
    expect(await listedCodes()).not.toContain('theirs');
    const own = await seedSubmission(api, {
      user: userId,
      problem: mine._id,
      language: catalog.languages.cpp,
    });
    const submissions = await authed(
      api.http().get('/api/internal/submissions?problem=mine'),
      session,
    ).expect(200);
    expect(dataOf<unknown[]>(submissions)).toHaveLength(1);
    await authed(
      api.http().get(`/api/internal/submissions/${own._id}`),
      session,
    ).expect(200);
    expect(await ownSubmissionCount()).toBe(1);
    await submit('mine').expect(201);
    await submit('theirs').expect(404);
  });

  it('hides every problem before the current contest starts', async () => {
    await createProblem(api, catalog, { code: 'public_one' });
    const upcoming = await createContest(api, {
      startTime: hoursFromNow(1),
      endTime: hoursFromNow(2),
    });
    await enter(upcoming._id);
    await problem('public_one').expect(404);
    await submit('public_one').expect(404);
    expect(await ownSubmissionCount()).toBe(0);
    expect(await listedCodes()).toEqual([]);
  });

  it("never grants another contest's private problem, and loses the contest's own once the user leaves", async () => {
    const own = await createProblem(api, catalog, {
      code: 'own_private',
      isPublic: false,
    });
    const foreign = await createProblem(api, catalog, {
      code: 'foreign_private',
      isPublic: false,
    });
    const contest = await createContest(api, {
      problems: [contestProblem(own._id, 0)],
    });
    await createContest(api, { problems: [contestProblem(foreign._id, 0)] });
    const stored = await seedSubmission(api, {
      user: userId,
      problem: own._id,
      language: catalog.languages.cpp,
    });
    await enter(contest._id);
    await problem('foreign_private').expect(404);
    await authed(
      api.http().get(`/api/internal/submissions/${stored._id}`),
      session,
    ).expect(200);
    await authed(
      api.http().post(`/api/internal/contests/${contest.key}/leave`),
      session,
    ).expect(204);
    await problem('own_private').expect(404);
    await authed(
      api.http().get(`/api/internal/submissions/${stored._id}`),
      session,
    ).expect(404);
  });

  it('loses access once the participation ended (cleared lazily)', async () => {
    const timed = await createProblem(api, catalog, {
      code: 'timed_private',
      isPublic: false,
    });
    const contest = await createContest(api, {
      timeLimit: 60,
      problems: [contestProblem(timed._id, 0)],
    });
    const participation = await enter(contest._id);
    await problem('timed_private').expect(200);
    await api.participations.updateOne(
      { _id: participation._id },
      { realStart: hoursFromNow(-1) },
    );
    await problem('timed_private').expect(404);
    expect(
      (await api.users.findById(userId).lean())!.currentParticipation,
    ).toBeNull();
  });

  it("does not grant a contest's problems through a participation that is not the current one", async () => {
    const kept = await createProblem(api, catalog, {
      code: 'kept_private',
      isPublic: false,
    });
    const other = await createProblem(api, catalog, {
      code: 'other_private',
      isPublic: false,
    });
    const current = await createContest(api, {
      problems: [contestProblem(kept._id, 0)],
    });
    const dormant = await createContest(api, {
      problems: [contestProblem(other._id, 0)],
    });
    await joinParticipation(api, dormant._id, userId);
    await enter(current._id);
    await problem('kept_private').expect(200);
    await problem('other_private').expect(404);
  });

  it('grants nothing once the current contest is no longer visible to the user', async () => {
    const hidden = await createProblem(api, catalog, {
      code: 'hidden_private',
      isPublic: false,
    });
    const contest = await createContest(api, {
      problems: [contestProblem(hidden._id, 0)],
    });
    await enter(contest._id);
    await problem('hidden_private').expect(200);
    await api.contests.updateOne({ _id: contest._id }, { isVisible: false });
    await problem('hidden_private').expect(404);
  });

  it('hides the editorial while in any contest, and shows it again after leaving', async () => {
    await createProblem(api, catalog, {
      code: 'solved_public',
      solution: {
        isPublic: true,
        publishOn: new Date('2026-01-01T00:00:00Z'),
        authors: [],
        content: 'x',
        contentHtml: '<p>x</p>',
      },
    });
    const contest = await createContest(api);
    const hasEditorial = async () =>
      dataOf<{ hasEditorial: boolean }>(
        await problem('solved_public').expect(200),
      ).hasEditorial;
    const editorial = () =>
      authed(
        api.http().get('/api/internal/problems/solved_public/editorial'),
        session,
      );
    await makeCurrent(api, userId, null);
    await editorial().expect(200);
    expect(await hasEditorial()).toBe(true);
    await enter(contest._id);
    await editorial().expect(404);
    expect(await hasEditorial()).toBe(false);
    await authed(
      api.http().post(`/api/internal/contests/${contest.key}/leave`),
      session,
    ).expect(204);
    await editorial().expect(200);
    expect(await hasEditorial()).toBe(true);
  });

  it('hides testcaseVisibility C output while in a contest, and on a contest submission until its contest ends', async () => {
    const outputProblem = await createProblem(api, catalog, {
      code: 'c_output',
      testcaseVisibility: 'C',
      testcaseResultVisibility: 'A',
    });
    const cases: SubmissionCase[] = [
      {
        position: 1,
        status: 'AC',
        time: 0.1,
        memory: 1,
        points: 1,
        total: 1,
        batch: null,
        feedback: '',
        extendedFeedback: '',
        output: '42',
      },
    ];
    const stored = await seedSubmission(api, {
      user: userId,
      problem: outputProblem._id,
      language: catalog.languages.cpp,
      cases,
    });
    const firstCase = async (id = stored._id) =>
      dataOf<{ cases: Array<Record<string, unknown>> }>(
        await authed(
          api.http().get(`/api/internal/submissions/${id}`),
          session,
        ).expect(200),
      ).cases[0];
    await makeCurrent(api, userId, null);
    expect(await firstCase()).toMatchObject({ output: '42' });
    const contest = await createContest(api, {
      problems: [contestProblem(outputProblem._id, 0)],
    });
    await enter(contest._id);
    expect(await firstCase()).not.toHaveProperty('output');
    const inContest = await seedSubmission(api, {
      user: userId,
      problem: outputProblem._id,
      language: catalog.languages.cpp,
      contest: contest._id,
      cases,
    });
    await makeCurrent(api, userId, null);
    expect(await firstCase(inContest._id)).not.toHaveProperty('output');
    await api.contests.updateOne(
      { _id: contest._id },
      { endTime: hoursFromNow(-0.5) },
    );
    expect(await firstCase(inContest._id)).toMatchObject({ output: '42' });
  });

  describe('submissions on a problem visible only through the current contest', () => {
    const listedIds = async (path: string) =>
      dataOf<Array<{ id: string }>>(
        await authed(api.http().get(path), session).expect(200),
      ).map((row) => row.id);
    const read = (path: string) => authed(api.http().get(path), session);
    /** A private problem in a contest, with an outside submission by its author. */
    const scoped = async (
      code: string,
      contestTimes: Partial<Contest> = {},
    ) => {
      const author = await createUserWith(api, `${code}_author`);
      const shared = await createProblem(api, catalog, {
        code,
        isPublic: false,
        authors: [author._id],
        submissionSourceVisibility: 'A',
      });
      const contest = await createContest(api, {
        problems: [contestProblem(shared._id, 0)],
        ...contestTimes,
      });
      const outside = await seedSubmission(api, {
        user: author._id,
        problem: shared._id,
        language: catalog.languages.cpp,
      });
      return { shared, contest, outsideId: outside._id };
    };

    it("serves only the contest's submissions and the viewer's own", async () => {
      const { shared, contest, outsideId } = await scoped('scoped_live');
      const ownPractice = await seedSubmission(api, {
        user: userId,
        problem: shared._id,
        language: catalog.languages.cpp,
      });
      await enter(contest._id);
      const ownContest = await seedSubmission(api, {
        user: userId,
        problem: shared._id,
        language: catalog.languages.cpp,
        contest: contest._id,
      });
      expect(
        (
          await listedIds('/api/internal/submissions?problem=scoped_live')
        ).sort(),
      ).toEqual([ownPractice._id, ownContest._id].sort());
      expect(
        await listedIds('/api/internal/submissions?pageSize=100'),
      ).not.toContain(outsideId);
      expect(
        await listedIds('/api/internal/problems/scoped_live/best-submissions'),
      ).not.toContain(outsideId);
      await read(`/api/internal/submissions/${outsideId}`).expect(404);
      await read(`/api/internal/submissions/${outsideId}/source`).expect(404);
    });

    it("serves an ended contest's submissions to a virtual participant, and nothing outside it", async () => {
      const { shared, contest, outsideId } = await scoped('scoped_virtual', {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-2),
      });
      const rival = await createUserWith(api, 'scoped_rival');
      const inContest = await seedSubmission(api, {
        user: rival._id,
        problem: shared._id,
        language: catalog.languages.cpp,
        contest: contest._id,
      });
      await enter(contest._id, { virtual: 1 });
      expect(
        await listedIds('/api/internal/submissions?problem=scoped_virtual'),
      ).toEqual([inContest._id]);
      await read(`/api/internal/submissions/${outsideId}`).expect(404);
    });
  });
});
