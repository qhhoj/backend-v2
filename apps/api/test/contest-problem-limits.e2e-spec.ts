import { newId } from '@libs/database';
import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
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
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('problem limits in the contest overview', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let alice: TestSession;
  let editor: TestSession;
  let editorId: string;
  const problemsOf = async (key: string, session?: TestSession) => {
    const request = api.http().get(contestUrl(key));
    const response = await (
      session ? authed(request, session) : request
    ).expect(200);
    return dataOf<ContestDetailResponse>(response).problems;
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    alice = await loginAs(api, (await createUserWith(api, 'limits_alice'))._id);
    editorId = (
      await createUserWith(api, 'limits_editor', {
        permissions: ['judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  afterAll(() => api.teardown());

  it('shows the limits of every contest problem to a participant, private problems included', async () => {
    const hidden = await createProblem(api, catalog, {
      code: 'lim_private',
      isPublic: false,
      timeLimit: 2,
      memoryLimit: 65536,
    });
    const open = await createProblem(api, catalog, {
      code: 'lim_public',
      timeLimit: 1,
      memoryLimit: 262144,
    });
    const contest = await createContest(api, {
      problems: [contestProblem(hidden._id, 0), contestProblem(open._id, 1)],
    });
    await authed(api.http().post(contestUrl(contest.key, '/join')), alice)
      .send({})
      .expect(201);
    const problems = (await problemsOf(contest.key, alice))!;
    expect(
      problems.map((row) => [row.code, row.timeLimit, row.memoryLimit]),
    ).toEqual([
      ['lim_private', 2, 65536],
      ['lim_public', 1, 262144],
    ]);
  });

  it('gives a signed-out visitor of an ended contest the limits of public problems only', async () => {
    const hidden = await createProblem(api, catalog, {
      code: 'end_private',
      isPublic: false,
    });
    const open = await createProblem(api, catalog, {
      code: 'end_public',
      timeLimit: 3,
    });
    const contest = await createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      problems: [contestProblem(hidden._id, 0), contestProblem(open._id, 1)],
    });
    const problems = (await problemsOf(contest.key))!;
    expect(problems.map((row) => [row.code, row.timeLimit !== null])).toEqual([
      ['end_private', false],
      ['end_public', true],
    ]);
    expect(problems[0].memoryLimit).toBeNull();
  });

  it('keeps a limit null for a contest editor who cannot see the private problem', async () => {
    const hidden = await createProblem(api, catalog, {
      code: 'edit_private',
      isPublic: false,
    });
    const contest = await createContest(api, {
      authors: [editorId],
      problems: [contestProblem(hidden._id, 0)],
    });
    const [row] = (await problemsOf(contest.key, editor))!;
    expect(row).toMatchObject({
      code: 'edit_private',
      timeLimit: null,
      memoryLimit: null,
    });
  });

  it('leaves out a contest problem whose document is gone instead of failing', async () => {
    const open = await createProblem(api, catalog, { code: 'gone_public' });
    const contest = await createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      problems: [contestProblem(newId(), 0), contestProblem(open._id, 1)],
    });
    expect((await problemsOf(contest.key))!.map((row) => row.code)).toEqual([
      'gone_public',
    ]);
  });
});
