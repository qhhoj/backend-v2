import {
  clearRateLimits,
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
import { clearBridgeCommands, dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const SUBS = '/api/internal/submissions';

describe('Contest access edges', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  let counter = 0;
  const as = (who: string) => ({
    post: (url: string) => authed(api.http().post(url), sessions[who]),
    get: (url: string) => authed(api.http().get(url), sessions[who]),
    patch: (url: string) => authed(api.http().patch(url), sessions[who]),
  });
  const newUser = async (name: string, extra = {}) => {
    users[name] = await createUserWith(api, name, extra);
    sessions[name] = await loginAs(api, users[name]._id);
  };
  const key = () => `edge_${(counter += 1)}`;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await clearBridgeCommands(api);
    await clearRateLimits(api);
  });

  it('a user who is no longer invited leaves the contest even when listed as a scoreboard viewer', async () => {
    await newUser('member');
    await newUser('owner', {
      permissions: ['judge.edit_own_contest', 'judge.create_private_contest'],
    });
    const problem = await createProblem(api, catalog, {
      code: 'edgepriv',
      isPublic: false,
    });
    const contest = await createContest(api, {
      key: key(),
      isPrivate: true,
      privateContestants: [users.member._id],
      viewContestScoreboard: [users.member._id],
      authors: [users.owner._id],
      problems: [contestProblem(problem._id, 0)],
    });
    await as('member')
      .post(contestUrl(contest.key, '/join'))
      .send({})
      .expect(201);
    await as('owner')
      .patch(contestUrl(contest.key))
      .send({ privateContestants: [] })
      .expect(200);
    const current = dataOf<unknown>(
      await as('member').get('/api/internal/contests/current').expect(200),
    );
    expect(current).toBeNull();
  });

  it('batch rejudge and rescore answer 404 alike for a problem outside the contest and an unknown code', async () => {
    await newUser('editor', {
      permissions: ['judge.edit_own_contest', 'judge.rejudge_submission'],
    });
    const outside = await createProblem(api, catalog, {
      code: 'edgehidden',
      isPublic: false,
    });
    const listed = await createProblem(api, catalog, { code: 'edgelisted' });
    const contest = await createContest(api, {
      key: key(),
      authors: [users.editor._id],
      problems: [contestProblem(listed._id, 0)],
    });
    const statusOf = async (route: string, problem: string) =>
      (
        await as('editor')
          .post(`${SUBS}/${route}`)
          .send({ contest: contest.key, problem, dryRun: true })
      ).status;
    for (const route of ['rejudge', 'rescore']) {
      expect(await statusOf(route, outside.code)).toBe(404);
      expect(await statusOf(route, 'edgenosuch')).toBe(404);
      expect(await statusOf(route, listed.code)).toBe(200);
    }
  });

  it('the contest submission list is empty before the start for a viewer who cannot see the problems yet', async () => {
    await newUser('viewer');
    await newUser('setter');
    const problem = await createProblem(api, catalog, {
      code: 'edgesecret',
      isPublic: false,
    });
    const contest = await createContest(api, {
      key: key(),
      startTime: hoursFromNow(2),
      endTime: hoursFromNow(5),
      showSubmissionList: true,
      scoreboardVisibility: 'H',
      viewContestScoreboard: [users.viewer._id],
      authors: [users.setter._id],
      problems: [contestProblem(problem._id, 0)],
    });
    await api.submissions.create({
      user: users.setter._id,
      problem: problem._id,
      language: catalog.languages.cpp,
      contest: contest._id,
      status: 'D',
      result: 'AC',
    });
    const read = async (who: string) =>
      (await as(who).get(contestUrl(contest.key, '/submissions')).expect(200))
        .body as { data?: unknown[] };
    expect(JSON.stringify(await read('viewer'))).not.toContain('edgesecret');
    expect(JSON.stringify(await read('setter'))).toContain('edgesecret');
  });
});
