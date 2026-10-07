import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { newId, toUuid } from '@libs/database';
import type { UUID } from 'mongodb';
import type { SubmissionResult, User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { ContestStatsResponse } from '../src/modules/contests/stats/dto/contest-stats.response';
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
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest stats', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Record<string, { _id: string }> = {};

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['editor', { permissions: ['judge.edit_own_contest'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    for (const code of ['alpha', 'beta'])
      problems[code] = await createProblem(api, catalog, { code });
  });
  afterAll(() => api.teardown());

  const stats = async (key: string, who?: string) =>
    dataOf<ContestStatsResponse>(
      await (
        who
          ? authed(api.http().get(contestUrl(key, '/stats')), sessions[who])
          : api.http().get(contestUrl(key, '/stats'))
      ).expect(200),
    );

  it('counts results per problem and per language after the start', async () => {
    const contest = await createContest(api, {
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
      problems: [
        contestProblem(problems.alpha._id, 0),
        contestProblem(problems.beta._id, 1),
      ],
    });
    const seed = (
      problem: string,
      language: string,
      result: SubmissionResult | null,
      date = hoursFromNow(-2),
    ) =>
      seedSubmission(api, {
        problem,
        language,
        user: users.alice._id,
        contest: contest._id,
        result,
        status: result ? 'D' : 'QU',
        date,
      });
    const { cpp, python } = catalog.languages;
    await seed(problems.alpha._id, cpp, 'AC');
    await seed(problems.alpha._id, cpp, 'WA');
    await seed(problems.alpha._id, python, 'RTE');
    await seed(problems.alpha._id, python, null);
    await seed(problems.beta._id, cpp, 'AC');
    await seed(problems.beta._id, cpp, 'AC', hoursFromNow(-4)); // before the start
    const body = await stats(contest.key);
    expect(
      body.problems.map(({ code, label, results, total, acRate }) => [
        code,
        label,
        results,
        total,
        acRate,
      ]),
    ).toEqual([
      ['alpha', '1', { AC: 1, WA: 1, CE: 0, TLE: 0, ERR: 1, RJ: 0 }, 4, 25],
      ['beta', '2', { AC: 1, WA: 0, CE: 0, TLE: 0, ERR: 0, RJ: 0 }, 1, 100],
    ]);
    expect(
      body.languages.map(({ name, count, acRate }) => [name, count, acRate]),
    ).toEqual([
      ['C++17', 3, 200 / 3],
      ['Python 3', 2, 0],
    ]);
  });

  it('refuses stats while the full submission list is hidden, and while frozen to non-editors', async () => {
    const running = await createContest(api, {
      authors: [users.editor._id],
    });
    await api.http().get(contestUrl(running.key, '/stats')).expect(403);
    await authed(
      api.http().get(contestUrl(running.key, '/stats')),
      sessions.editor,
    ).expect(200);
    const frozen = await createContest(api, {
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
      formatName: 'icpc',
      formatConfig: {},
      frozenLastMinutes: 60,
      authors: [users.editor._id],
      showSubmissionList: true,
      problems: [contestProblem(problems.alpha._id, 0)],
    });
    await api.http().get(contestUrl(frozen.key, '/stats')).expect(403);
    await authed(
      api.http().get(contestUrl(frozen.key, '/stats')),
      sessions.alice,
    ).expect(403);
    await seedSubmission(api, {
      problem: problems.alpha._id,
      language: catalog.languages.cpp,
      user: users.alice._id,
      contest: frozen._id,
      date: hoursFromNow(-1.5),
    });
    const editorStats = await stats(frozen.key, 'editor');
    expect(editorStats.problems).toMatchObject([
      { code: 'alpha', total: 1, results: { AC: 1 } },
    ]);
    expect(editorStats.languages).toMatchObject([{ count: 1, acRate: 100 }]);
  });

  it('reads one contest through the contest index', async () => {
    const db = api.app.get<Connection>(getConnectionToken()).db!;
    const big = await createContest(api, {
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
      showSubmissionList: true,
      problems: [contestProblem(problems.alpha._id, 0)],
    });
    const other = await createContest(api);
    const insert = (contestId: string) =>
      db.collection<{ _id: UUID }>('submissions').insertMany(
        Array.from({ length: 2_000 }, () => ({
          _id: toUuid(newId()),
          contest: toUuid(contestId),
          problem: toUuid(problems.alpha._id),
          language: toUuid(catalog.languages.cpp),
          user: toUuid(users.alice._id),
          status: 'D',
          result: 'AC',
          date: hoursFromNow(-2),
        })),
      );
    await insert(big._id);
    await insert(other._id);
    const operations = await profileQueries(db, () => stats(big.key));
    expect(
      operations.filter(({ planSummary }) => planSummary === 'COLLSCAN'),
    ).toEqual([]);
    expect((await stats(big.key)).problems[0].total).toBe(2_000);
  });
});
