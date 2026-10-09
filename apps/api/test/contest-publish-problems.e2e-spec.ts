import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { newId } from '@libs/database';
import type { Problem } from '@libs/database';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import type { PublishProblemsResponse } from '../src/modules/contests/publish/dto/publish-problems.response';
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
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('publish contest problems after the contest', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let rescores: Queue<ProblemRescoreJob>;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  let sequence = 0;

  const newUser = async (name: string, permissions: string[]) => {
    ids[name] = (await createUserWith(api, name, { permissions }))._id;
    sessions[name] = await loginAs(api, ids[name]);
  };
  const run = (who: string, key: string, body: object = {}) =>
    authed(
      api.http().post(contestUrl(key, '/publish-problems')),
      sessions[who],
    ).send(body);
  const resultOf = (response: { body: unknown }) =>
    dataOf<PublishProblemsResponse>(response);
  /** An ended contest holding one problem per spec; problems are private and the owner's unless the spec says otherwise. */
  const endedContest = async (
    specs: Array<Partial<Problem>>,
    authors: string[],
  ) => {
    const created: Problem[] = [];
    for (const spec of specs) {
      sequence += 1;
      created.push(
        await createProblem(api, catalog, {
          code: `pub${sequence}`,
          isPublic: false,
          authors: [ids.owner],
          ...spec,
        }),
      );
    }
    const contest = await createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      authors,
      problems: created.map((problem, order) =>
        contestProblem(problem._id, order),
      ),
    });
    return { contest, problems: created };
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    rescores = api.app.get(getQueueToken(PROBLEM_RESCORE_QUEUE));
    await newUser('owner', [
      'judge.edit_own_contest',
      'judge.edit_own_problem',
      'judge.change_public_visibility',
    ]);
    await newUser('limited', [
      'judge.edit_own_contest',
      'judge.edit_own_problem',
    ]);
    await newUser('plain', []);
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await clearRateLimits(api);
    await rescores.obliterate({ force: true });
  });

  it('refuses before the end and for a user who does not edit the contest', async () => {
    const running = await createContest(api, { authors: [ids.owner] });
    await run('owner', running.key)
      .expect(409)
      .expect(errorCode('contest_not_ended'));
    const { contest } = await endedContest([{}], [ids.owner]);
    await run('plain', contest.key).expect(403);
  });

  it('reports a dry run without writing, and the real run does exactly that', async () => {
    const { contest, problems } = await endedContest(
      [
        {},
        {
          solution: {
            isPublic: false,
            publishOn: new Date(),
            authors: [],
            content: 'e',
            contentHtml: '<p>e</p>',
          },
        },
        { isOrganizationPrivate: true, organizations: [newId()] },
        { isPublic: true },
        { authors: [newId()] },
        {
          isPublic: true,
          authors: [newId()],
          solution: {
            isPublic: false,
            publishOn: new Date(),
            authors: [],
            content: 'f',
            contentHtml: '<p>f</p>',
          },
        },
      ],
      [ids.owner],
    );
    const dry = resultOf(
      await run('owner', contest.key, {
        editorials: true,
        dryRun: true,
      }).expect(200),
    );
    const shape = (result: PublishProblemsResponse) =>
      result.items.map(({ outcome, reason, editorial }) => [
        outcome,
        reason,
        editorial,
      ]);
    expect(dry.dryRun).toBe(true);
    expect(shape(dry)).toEqual([
      ['published', null, 'none'],
      ['published', null, 'published'],
      ['skipped', 'organization_private', 'skipped'],
      ['unchanged', null, 'none'],
      ['skipped', 'no_permission', 'skipped'],
      ['unchanged', null, 'skipped'],
    ]);
    expect(
      (await api.problems.findById(problems[0]._id).lean())!.isPublic,
    ).toBe(false);
    expect(
      (await api.problems.findById(problems[1]._id).lean())!.solution!.isPublic,
    ).toBe(false);
    expect(await rescores.getJobs(['waiting', 'delayed'])).toHaveLength(0);

    const real = resultOf(
      await run('owner', contest.key, { editorials: true }).expect(200),
    );
    expect(real.dryRun).toBe(false);
    expect(shape(real)).toEqual(shape(dry));
    const stored = await api.problems
      .find({ _id: { $in: problems.map((entry) => entry._id) } })
      .lean();
    const byCode = new Map(stored.map((problem) => [problem.code, problem]));
    expect(byCode.get(problems[0].code)!.isPublic).toBe(true);
    expect(byCode.get(problems[1].code)!.isPublic).toBe(true);
    expect(byCode.get(problems[1].code)!.solution).toMatchObject({
      isPublic: true,
    });
    expect(byCode.get(problems[2].code)!.isPublic).toBe(false);
    expect(byCode.get(problems[4].code)!.isPublic).toBe(false);
    const revisions = await api.revisions
      .find({ entity: 'problem', entityId: problems[0]._id })
      .lean();
    expect(revisions.map((revision) => revision.action)).toContain('edit');
    await waitUntil(
      async () => (await rescores.getJobs(['waiting'])).length === 2,
    );
    expect(
      (await rescores.getJobs(['waiting']))
        .map((job) => job.data.problemId)
        .sort(),
    ).toEqual([problems[0]._id, problems[1]._id].sort());
  });

  it('leaves editorials alone unless asked', async () => {
    const { contest, problems } = await endedContest(
      [
        {
          solution: {
            isPublic: false,
            publishOn: new Date(),
            authors: [],
            content: 'e',
            contentHtml: '<p>e</p>',
          },
        },
      ],
      [ids.owner],
    );
    const result = resultOf(await run('owner', contest.key).expect(200));
    expect(result.items[0]).toMatchObject({
      outcome: 'published',
      editorial: null,
    });
    expect(
      (await api.problems.findById(problems[0]._id).lean())!.solution!.isPublic,
    ).toBe(false);
  });

  it('skips every problem for an editor without change_public_visibility', async () => {
    const { contest, problems } = await endedContest(
      [{ authors: [ids.limited] }],
      [ids.limited],
    );
    const result = resultOf(await run('limited', contest.key).expect(200));
    expect(result.items[0]).toMatchObject({
      outcome: 'skipped',
      reason: 'no_permission',
    });
    expect(
      (await api.problems.findById(problems[0]._id).lean())!.isPublic,
    ).toBe(false);
  });

  it('answers 200 with an empty list for a contest without problems and skips a missing problem', async () => {
    const empty = await createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      authors: [ids.owner],
    });
    expect(resultOf(await run('owner', empty.key).expect(200)).items).toEqual(
      [],
    );
    const missingId = newId();
    const holed = await createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      authors: [ids.owner],
      problems: [contestProblem(missingId, 0)],
    });
    const [item] = resultOf(await run('owner', holed.key).expect(200)).items;
    expect(item).toEqual({
      problemId: missingId,
      code: null,
      outcome: 'skipped',
      reason: 'not_found',
      editorial: null,
    });
  });

  it('allows five real runs an hour and keeps dry runs free', async () => {
    const { contest } = await endedContest([{ isPublic: true }], [ids.owner]);
    for (let count = 0; count < 5; count += 1)
      await run('owner', contest.key).expect(200);
    await run('owner', contest.key)
      .expect(429)
      .expect(errorCode('rate_limited'));
    await run('owner', contest.key, { dryRun: true }).expect(200);
  });
});
