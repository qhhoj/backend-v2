import type { Contest } from '@libs/database';
import type { SubmissionDetailResponse } from '../src/modules/submissions/core/dto/submission-detail.response';
import {
  contestProblem,
  createContest,
  hoursFromNow,
  joinParticipation,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { softDelete } from './deleted-problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe("a submission's contest on its result page", () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    users.alice = await createUserWith(api, 'alice', {});
    users.staff = await createUserWith(api, 'staff', {
      permissions: ['judge.view_all_submission'],
    });
    for (const name of Object.keys(users))
      sessions[name] = await loginAs(api, users[name]._id);
  });
  afterAll(() => api.teardown());

  /** `who` null asks as a visitor. */
  const contestOf = async (who: string | null, id: string) => {
    const request = api.http().get(`/api/internal/submissions/${id}`);
    const response = await (who ? authed(request, sessions[who]) : request);
    expect(response.status).toBe(200);
    return dataOf<SubmissionDetailResponse>(response).contest;
  };

  /** Alice's submission with 7 of 20 case points in an ended contest (a 100-point partial problem; `stored` is its contest row, null for none), plus one of hers outside it. */
  const scene = async (
    code: string,
    {
      stored = 0,
      extra = {},
    }: { stored?: number | null; extra?: Partial<Contest> } = {},
  ) => {
    const problem = await createProblem(api, catalog, { code, partial: true });
    const contest = await createContest(api, {
      name: `Round ${code}`,
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
      problems: [contestProblem(problem._id, 0)],
      ...extra,
    });
    const participation = await joinParticipation(
      api,
      contest._id,
      users.alice._id,
    );
    const fields = {
      user: users.alice._id,
      problem: problem._id,
      language: catalog.languages.cpp,
    };
    const inContest = await seedSubmission(api, {
      ...fields,
      contest: contest._id,
      result: 'WA',
      casePoints: 7,
      caseTotal: 20,
    });
    if (stored !== null)
      await api.contestSubmissions.create({
        _id: inContest._id,
        participation: participation._id,
        contest: contest._id,
        problem: problem._id,
        points: stored,
      });
    const outside = await seedSubmission(api, fields);
    return {
      contest,
      problemId: problem._id,
      inContestId: inContest._id,
      outsideId: outside._id,
    };
  };

  it("names the contest and scores the cases in the contest problem's points before the worker stores them", async () => {
    const { contest, inContestId, outsideId } = await scene('block_public');
    expect(await contestOf('alice', inContestId)).toEqual({
      key: contest.key,
      name: 'Round block_public',
      points: 35,
    });
    for (const viewer of ['staff', null])
      expect((await contestOf(viewer, inContestId))?.points).toBe(35);
    expect(await contestOf('alice', outsideId)).toBeNull();
  });

  it('keeps the stored points of a problem that left the contest, null without a row', async () => {
    const left = await scene('block_left', {
      stored: 20,
      extra: { problems: [] },
    });
    expect((await contestOf('alice', left.inContestId))?.points).toBe(20);
    const unscored = await scene('block_no_row', {
      stored: null,
      extra: { problems: [] },
    });
    expect((await contestOf('alice', unscored.inContestId))?.points).toBeNull();
  });

  it('keeps the contest of a submission whose problem was deleted', async () => {
    const { contest, problemId, inContestId } = await scene('block_deleted');
    await softDelete(api, problemId);
    expect((await contestOf('alice', inContestId))?.key).toBe(contest.key);
  });

  it('leaves the contest out for a viewer who may not see the contest', async () => {
    const { contest, inContestId } = await scene('block_private', {
      extra: { isPrivate: true, privateContestants: [users.alice._id] },
    });
    expect(await contestOf('staff', inContestId)).toBeNull();
    expect((await contestOf('alice', inContestId))?.key).toBe(contest.key);
  });

  it('leaves out a hidden contest, even for its own participant', async () => {
    const { inContestId } = await scene('block_hidden', {
      extra: { isVisible: false },
    });
    expect(await contestOf('alice', inContestId)).toBeNull();
  });
});
