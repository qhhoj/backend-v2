import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_MOSS_QUEUE } from '@libs/contests';
import type { ContestMossJob } from '@libs/contests';
import type { ContestMossResponse } from '../src/modules/contests/moss/dto/contest-moss.response';
import { contestProblem, contestUrl, createContest } from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const MOSS_URL = 'http://moss.stanford.edu/results/1/2';

describe('contest MOSS routes', () => {
  let api: ApiTest;
  let keyless: ApiTest;
  let catalog: Catalog;
  let mossQueue: Queue<ContestMossJob>;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const roles = {
    mossEditor: ['judge.moss_contest', 'judge.edit_own_contest'],
    author: ['judge.edit_own_contest'],
    mossOutsider: ['judge.moss_contest'],
  };
  const moss = (method: 'get' | 'post' | 'delete', key: string, who: string) =>
    authed(api.http()[method](contestUrl(key, '/moss')), sessions[who]);

  beforeAll(async () => {
    // Both apps flush the shared Redis when they boot: neither may start after a session exists.
    api = await setupApiTest({ env: { MOSS_API_KEY: 'k' } });
    keyless = await setupApiTest();
    catalog = await seedCatalog(api);
    mossQueue = api.app.get(getQueueToken(CONTEST_MOSS_QUEUE));
    for (const [name, permissions] of Object.entries(roles)) {
      users[name] = await createUserWith(api, name, { permissions });
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterAll(async () => {
    await api.teardown();
    await keyless.teardown();
  });
  beforeEach(async () => {
    await mossQueue.obliterate({ force: true });
    await api.contestMoss.deleteMany({});
  });

  it('answers 404 everywhere when MOSS is not configured', async () => {
    const editor = await createUserWith(keyless, 'keyless_editor', {
      permissions: roles.mossEditor,
    });
    const session = await loginAs(keyless, editor._id);
    const contest = await createContest(keyless, { authors: [editor._id] });
    for (const method of ['get', 'post', 'delete'] as const)
      await authed(
        keyless.http()[method](contestUrl(contest.key, '/moss')),
        session,
      )
        .expect(404)
        .expect(errorCode('not_found'));
  });

  it('queues only the contest id, once per contest, for editors with judge.moss_contest', async () => {
    const contest = await createContest(api, {
      authors: [users.mossEditor._id, users.author._id],
    });
    await moss('post', contest.key, 'author').expect(403); // edits, no permission
    await moss('post', contest.key, 'mossOutsider').expect(403); // permission, not an editor
    expect(await mossQueue.count()).toBe(0);
    await moss('post', contest.key, 'mossEditor').expect(202);
    await moss('post', contest.key, 'mossEditor')
      .expect(409)
      .expect(errorCode('conflict'));
    // Nothing else, the MOSS key above all, travels in the job.
    expect(
      (await mossQueue.getJobs(['waiting'])).map((job) => job.data),
    ).toEqual([{ contestId: contest._id }]);
    expect(
      dataOf<ContestMossResponse>(
        await moss('get', contest.key, 'mossEditor').expect(200),
      ).running,
    ).toBe(true);
  });

  it('lists results in contest and language order and clears them', async () => {
    const problems = {
      first: await createProblem(api, catalog, { code: 'mossa' }),
      second: await createProblem(api, catalog, { code: 'mossb' }),
    };
    const contest = await createContest(api, {
      authors: [users.mossEditor._id],
      problems: [
        contestProblem(problems.first._id, 0),
        contestProblem(problems.second._id, 1),
      ],
    });
    await api.contestMoss.create([
      {
        contest: contest._id,
        problem: problems.second._id,
        language: 'Python',
        submissionCount: 1,
        url: null,
      },
      {
        contest: contest._id,
        problem: problems.second._id,
        language: 'C++',
        submissionCount: 2,
        url: MOSS_URL,
      },
      {
        contest: contest._id,
        problem: problems.first._id,
        language: 'Java',
        submissionCount: 0,
        url: null,
      },
    ]);
    const shown = dataOf<ContestMossResponse>(
      await moss('get', contest.key, 'mossEditor').expect(200),
    );
    expect(shown.running).toBe(false);
    expect(
      shown.results.map((row) => [
        row.code,
        row.label,
        row.language,
        row.submissionCount,
        row.url,
      ]),
    ).toEqual([
      ['mossa', '1', 'Java', 0, null],
      ['mossb', '2', 'C++', 2, MOSS_URL],
      ['mossb', '2', 'Python', 1, null],
    ]);
    await moss('delete', contest.key, 'mossEditor').expect(204);
    expect(await api.contestMoss.countDocuments({ contest: contest._id })).toBe(
      0,
    );
  });

  it('keeps the results of other contests when clearing', async () => {
    const problem = await createProblem(api, catalog, { code: 'mossc' });
    const [cleared, kept] = [
      await createContest(api, { authors: [users.mossEditor._id] }),
      await createContest(api, { authors: [users.mossEditor._id] }),
    ];
    await api.contestMoss.create(
      [cleared, kept].map((contest) => ({
        contest: contest._id,
        problem: problem._id,
        language: 'C++' as const,
        submissionCount: 1,
        url: MOSS_URL,
      })),
    );
    await moss('delete', cleared.key, 'mossEditor').expect(204);
    expect(await api.contestMoss.countDocuments({ contest: kept._id })).toBe(1);
  });
});
