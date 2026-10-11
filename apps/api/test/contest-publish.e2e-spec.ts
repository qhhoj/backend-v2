import type { PublishProblemsResponse } from '../src/modules/contests/publish/dto/publish-problems.response';

import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  clearRateLimits,
} from './contest-fixtures';

import { softDelete } from './deleted-problem-fixtures';

import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';

import type { TestSession, Catalog } from './problem-fixtures';

import { setupApiTest, errorCode } from './setup';

import type { ApiTest } from './setup';

import { dataOf } from './submission-fixtures';

import { getQueueToken } from '@nestjs/bullmq';

import type { Queue } from 'bullmq';

import { CONTEST_PUBLISH_QUEUE, publishJobId } from '@libs/contests';

import type { ContestPublishJob } from '@libs/contests';

import { newId } from '@libs/database';
import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';

import { waitUntil } from '@libs/common/testing';

import type { Problem } from '@libs/database';

import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';

import type { ProblemRescoreJob } from '@libs/judging';

import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from contest-publish-deleted.e2e-spec.ts
{
  describe('publishing a contest that lists a deleted problem', () => {
    beforeAll(() => api.reset());
    let owner: TestSession;
    let ownerId: string;

    beforeAll(async () => {
      ownerId = (
        await createUserWith(api, 'pubdel_owner', {
          permissions: [
            'judge.edit_own_contest',
            'judge.edit_own_problem',
            'judge.change_public_visibility',
          ],
        })
      )._id;
      owner = await loginAs(api, ownerId);
    });

    it('reports skipped: deleted and publishes nothing for it', async () => {
      const catalog = await seedCatalog(api);
      const problem = await createProblem(api, catalog, {
        code: 'pubdel_gone',
        isPublic: false,
        authors: [ownerId],
        solution: {
          isPublic: false,
          publishOn: new Date(),
          authors: [],
          content: 'e',
          contentHtml: '<p>e</p>',
        },
      });
      await softDelete(api, problem._id);
      const contest = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        authors: [ownerId],
        problems: [contestProblem(problem._id, 0)],
      });
      const result = dataOf<PublishProblemsResponse>(
        await authed(
          api.http().post(contestUrl(contest.key, '/publish-problems')),
          owner,
        )
          .send({ editorials: true })
          .expect(200),
      );
      expect(result.items).toEqual([
        expect.objectContaining({
          outcome: 'skipped',
          reason: 'deleted',
          editorial: 'skipped',
        }),
      ]);
      const stored = (await api.problems.findById(problem._id).lean())!;
      expect(stored.isPublic).toBe(false);
      expect(stored.solution!.isPublic).toBe(false);
    });
  });
}

// from contest-publish-schedule.e2e-spec.ts
{
  describe('scheduling of the automatic publish', () => {
    beforeAll(() => api.reset());
    let queue: Queue<ContestPublishJob>;
    let editor: TestSession;
    let editorId: string;
    const jobIds = async () =>
      (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);
    const patch = (key: string, body: object) =>
      authed(api.http().patch(contestUrl(key)), editor).send(body);

    beforeAll(async () => {
      queue = api.app.get(getQueueToken(CONTEST_PUBLISH_QUEUE));
      editorId = (
        await createUserWith(api, 'schedule_editor', {
          permissions: [
            'judge.add_contest',
            'judge.edit_own_contest',
            'judge.clone_contest',
          ],
        })
      )._id;
      editor = await loginAs(api, editorId);
    });
    beforeEach(() => queue.obliterate({ force: true }));

    it('schedules the job when the switch comes on, moves it with the end time and drops it when the switch goes off', async () => {
      const contest = await createContest(api, {
        authors: [editorId],
        endTime: hoursFromNow(3),
      });
      expect(await jobIds()).toEqual([]);
      await patch(contest.key, { publishAfterEnd: true }).expect(200);
      expect(await jobIds()).toEqual([
        publishJobId(contest._id, contest.endTime),
      ]);
      const later = hoursFromNow(4);
      await patch(contest.key, { endTime: later.toISOString() }).expect(200);
      expect(await jobIds()).toEqual([publishJobId(contest._id, later)]);
      await patch(contest.key, { publishAfterEnd: false }).expect(200);
      expect(await jobIds()).toEqual([]);
    });
  });
}

// from contest-publish-switch.e2e-spec.ts
{
  describe('auto-publish switch in the contest editor', () => {
    beforeAll(() => api.reset());
    const sessions: Record<string, TestSession> = {};
    const ids: Record<string, string> = {};
    const patch = (who: string, key: string, body: object) =>
      authed(api.http().patch(contestUrl(key)), sessions[who]).send(body);
    const settingsOf = (response: { body: unknown }) =>
      dataOf<ContestDetailResponse>(response).settings!;

    beforeAll(async () => {
      for (const name of ['first_editor', 'second_editor']) {
        ids[name] = (
          await createUserWith(api, name, {
            permissions: ['judge.edit_own_contest', 'judge.add_contest'],
          })
        )._id;
        sessions[name] = await loginAs(api, ids[name]);
      }
    });

    it('records who switched it on, keeps them when it is sent again, and forgets them when it goes off', async () => {
      const contest = await createContest(api, {
        authors: [ids.first_editor, ids.second_editor],
      });
      const on = settingsOf(
        await patch('first_editor', contest.key, {
          publishAfterEnd: true,
        }).expect(200),
      );
      expect(on).toMatchObject({
        publishAfterEnd: true,
        publishAfterEndBy: ids.first_editor,
      });
      const again = settingsOf(
        await patch('second_editor', contest.key, {
          publishAfterEnd: true,
        }).expect(200),
      );
      expect(again.publishAfterEndBy).toBe(ids.first_editor);
      const off = settingsOf(
        await patch('second_editor', contest.key, {
          publishAfterEnd: false,
        }).expect(200),
      );
      expect(off).toMatchObject({
        publishAfterEnd: false,
        publishAfterEndBy: null,
      });
      const back = settingsOf(
        await patch('second_editor', contest.key, {
          publishAfterEnd: true,
        }).expect(200),
      );
      expect(back.publishAfterEndBy).toBe(ids.second_editor);
    });
  });
}

// from contest-publish-problems.e2e-spec.ts
{
  describe('publish contest problems after the contest', () => {
    beforeAll(() => api.reset());
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
    beforeEach(async () => {
      await clearRateLimits(api);
      await rescores.obliterate({ force: true });
    });

    it('refuses before the end and for a user who does not edit the contest', async () => {
      const running = await createContest(api, { authors: [ids.owner] });
      const refused = await run('owner', running.key)
        .expect(409)
        .expect(errorCode('contest_not_ended'));
      expect(
        (refused.body as { error: { issues: unknown[] } }).error.issues,
      ).toEqual([
        expect.objectContaining({
          field: 'endTime',
          code: 'contest_not_ended',
        }),
      ]);
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
        (await api.problems.findById(problems[1]._id).lean())!.solution!
          .isPublic,
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
        (await api.problems.findById(problems[0]._id).lean())!.solution!
          .isPublic,
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
        code: null,
      });
      expect(
        (await api.problems.findById(problems[0]._id).lean())!.isPublic,
      ).toBe(false);
    });

    it('reports a trashed problem as deleted with its code for an editor, and a flagged private one as no_permission to an actor without rights', async () => {
      const { contest, problems } = await endedContest(
        [{ deletedAt: new Date() }, { isOrganizationPrivate: true }],
        [ids.owner, ids.limited],
      );
      const owner = resultOf(await run('owner', contest.key).expect(200)).items;
      expect(owner[0]).toMatchObject({
        problemId: problems[0]._id,
        code: problems[0].code,
        outcome: 'skipped',
        reason: 'deleted',
      });
      const limited = resultOf(
        await run('limited', contest.key).expect(200),
      ).items;
      expect(limited[1]).toMatchObject({
        code: null,
        outcome: 'skipped',
        reason: 'no_permission',
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

    it('releases an editorial once even when two writers race', async () => {
      const [problem] = (
        await endedContest(
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
        )
      ).problems;
      const problems = api.app.get(ProblemsRepository);
      const now = new Date();
      const wins = await Promise.all([
        problems.releaseSolution(problem._id, now),
        problems.releaseSolution(problem._id, now),
      ]);
      expect(wins.filter(Boolean)).toHaveLength(1);
      expect(
        (await api.problems.findById(problem._id).lean())!.solution,
      ).toMatchObject({ isPublic: true });
    });
  });
}
