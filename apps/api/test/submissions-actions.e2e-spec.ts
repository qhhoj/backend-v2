import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import type { Submission } from '@libs/database';
import {
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
import {
  bridgeCommands,
  clearBridgeCommands,
  dataOf,
  seedSubmission,
} from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const SUBMISSIONS = '/api/internal/submissions';

describe('submission actions', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let graded: Queue<SubmissionGradedJob>;
  let problemId: string;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  const post = (who: string, path: string, body: object = {}) =>
    authed(api.http().post(path), sessions[who]).send(body);
  const seed = async (fields: Partial<Submission> = {}) =>
    (
      await seedSubmission(api, {
        user: ids.owner,
        problem: problemId,
        language: catalog.languages.cpp,
        ...fields,
      })
    )._id;
  const row = async (id: string) =>
    (await api.submissions.findById(id).select('+cases').lean())!;
  const gradedIds = async () =>
    (await graded.getJobs(['waiting'])).map((job) => job.data.submissionId);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    graded = api.app.get(getQueueToken(SUBMISSION_GRADED_QUEUE));
    const roles: Array<[string, object]> = [
      ['owner', {}],
      ['other', {}],
      ['aborter', { permissions: ['judge.abort_any_submission'] }],
      [
        'manager',
        {
          permissions: [
            'judge.edit_own_problem',
            'judge.rejudge_submission',
            'judge.reject_submission',
          ],
        },
      ],
      [
        'lot',
        {
          permissions: [
            'judge.edit_own_problem',
            'judge.rejudge_submission',
            'judge.rejudge_submission_lot',
          ],
        },
      ],
      ['editor', { permissions: ['judge.edit_own_problem'] }],
      [
        'outsider',
        {
          permissions: [
            'judge.edit_own_problem',
            'judge.rejudge_submission',
            'judge.reject_submission',
          ],
        },
      ],
    ];
    for (const [name, extra] of roles) {
      ids[name] = (await createUserWith(api, name, extra))._id;
      sessions[name] = await loginAs(api, ids[name]);
    }
    problemId = (
      await createProblem(api, catalog, {
        code: 'acts',
        authors: [ids.manager, ids.lot, ids.editor],
      })
    )._id;
    await createProblem(api, catalog, {
      code: 'hidden',
      isPublic: false,
      authors: [ids.manager],
    });
  });
  beforeEach(async () => {
    await api.submissions.deleteMany({});
    await clearBridgeCommands(api);
    await graded.obliterate({ force: true });
  });
  afterAll(() => api.teardown());

  describe('abort', () => {
    it('refuses other users, and the owner once an admin rejudged it', async () => {
      const id = await seed({ status: 'QU', result: null });
      await post('other', `${SUBMISSIONS}/${id}/abort`)
        .expect(403)
        .expect(errorCode('forbidden'));
      const rejudged = await seed({
        status: 'QU',
        result: null,
        rejudgedDate: new Date(),
      });
      await post('owner', `${SUBMISSIONS}/${rejudged}/abort`).expect(403);
      expect((await row(id)).status).toBe('QU');
    });
  });

  describe('rejudge and reject', () => {
    it('rejudges for editors holding judge.rejudge_submission: cleared, queued at rejudge priority, bridge told', async () => {
      const id = await seed({
        points: 100,
        casePoints: 2,
        caseTotal: 2,
        time: 0.5,
        cases: [
          {
            position: 1,
            status: 'AC',
            time: 0.5,
            memory: 1,
            points: 2,
            total: 2,
            batch: null,
            feedback: '',
            extendedFeedback: '',
            output: '',
          },
        ],
        requeueCount: 1,
        retryCount: 2,
        judgeGeneration: 3,
        error: 'OLD LOG',
        judgedOn: 'judge-9',
        judgedDate: new Date(),
        memory: 123,
        currentTestcase: 4,
        batch: true,
        isPretested: true,
        effectsDueAt: new Date(),
        pinnedJudge: 'judge-9',
      });
      await post('manager', `${SUBMISSIONS}/${id}/rejudge`).expect(204);
      const after = await row(id);
      expect(after).toMatchObject({
        status: 'QU',
        result: null,
        points: null,
        casePoints: 0,
        time: null,
        cases: [],
        priority: 2,
        requeueCount: 0,
        retryCount: 0,
        judgeGeneration: 3,
        error: null,
        judgedOn: null,
        judgedDate: null,
        memory: null,
        caseTotal: 0,
        currentTestcase: 0,
        batch: false,
        isPretested: false,
        effectsDueAt: null,
        pinnedJudge: null,
      });
      expect(after.rejudgedDate).toBeInstanceOf(Date);
      expect(await bridgeCommands(api)).toEqual([
        {
          type: 'judge',
          submissionIds: [id],
          judgeName: null,
          bannedJudges: [],
        },
      ]);
    });

    it('refuses rejudging without the permission or edit rights, while judging, and when locked', async () => {
      const id = await seed();
      await post('owner', `${SUBMISSIONS}/${id}/rejudge`).expect(403);
      await post('outsider', `${SUBMISSIONS}/${id}/rejudge`).expect(403);
      const running = await seed({ status: 'P', result: null });
      await post('manager', `${SUBMISSIONS}/${running}/rejudge`)
        .expect(409)
        .expect(errorCode('conflict'));
      const locked = await seed({ lockedAfter: new Date(Date.now() - 1000) });
      await post('manager', `${SUBMISSIONS}/${locked}/rejudge`).expect(409);
      const lockLater = await seed({
        lockedAfter: new Date(Date.now() + 3600_000),
      });
      await post('manager', `${SUBMISSIONS}/${lockLater}/rejudge`).expect(204);
      expect((await row(id)).status).toBe('D');
    });

    it('rejects a finished submission: RJ, no points, cases cleared, graded', async () => {
      const id = await seed({
        points: 100,
        casePoints: 2,
        cases: [
          {
            position: 1,
            status: 'AC',
            time: 0.1,
            memory: 1,
            points: 2,
            total: 2,
            batch: null,
            feedback: '',
            extendedFeedback: '',
            output: '',
          },
        ],
      });
      await post('manager', `${SUBMISSIONS}/${id}/reject`).expect(204);
      expect(await row(id)).toMatchObject({
        status: 'D',
        result: 'RJ',
        points: 0,
        casePoints: 0,
        cases: [],
        effectsDueAt: expect.any(Date) as Date,
      });
      expect(await gradedIds()).toEqual([id]);
      const queued = await seed({ status: 'QU', result: null });
      await post('manager', `${SUBMISSIONS}/${queued}/reject`).expect(409);
      await post('owner', `${SUBMISSIONS}/${id}/reject`).expect(403);
    });

    describe('while the moderator spectates an upcoming contest (no contest scope)', () => {
      beforeEach(async () => {
        const upcoming = await createContest(api, {
          startTime: hoursFromNow(5),
          endTime: hoursFromNow(8),
        });
        await makeCurrent(
          api,
          ids.manager,
          (await joinParticipation(api, upcoming._id, ids.manager))._id,
        );
      });
      afterEach(() => makeCurrent(api, ids.manager, null));

      it('rejudges', async () => {
        await post('manager', `${SUBMISSIONS}/${await seed()}/rejudge`).expect(
          204,
        );
      });

      it('rejects', async () => {
        await post('manager', `${SUBMISSIONS}/${await seed()}/reject`).expect(
          204,
        );
      });

      it('bulk rejudges', async () => {
        await seed();
        expect(
          dataOf(
            await post('manager', `${SUBMISSIONS}/rejudge`, {
              problem: 'acts',
            }).expect(200),
          ),
        ).toEqual({ count: 1, dryRun: false, allowed: true });
      });
    });
  });

  describe('visibility and permissions', () => {
    it('still succeeds once, without a retry hazard, when the graded job cannot be enqueued', async () => {
      const add = jest
        .spyOn(graded, 'add')
        .mockRejectedValue(new Error('redis down'));
      try {
        const queued = await seed({ status: 'QU', result: null });
        await post('owner', `${SUBMISSIONS}/${queued}/abort`).expect(204);
        expect((await row(queued)).status).toBe('AB');
        const finished = await seed();
        await post('manager', `${SUBMISSIONS}/${finished}/reject`).expect(204);
        expect((await row(finished)).result).toBe('RJ');
        expect(add).toHaveBeenCalledTimes(2);
      } finally {
        add.mockRestore();
      }
      expect(await gradedIds()).toEqual([]);
    });
  });

  describe('bulk rejudge', () => {
    const bulk = (who: string, body: object) =>
      post(who, `${SUBMISSIONS}/rejudge`, { problem: 'acts', ...body });

    it('needs judge.rejudge_submission_lot above 10 submissions and changes nothing without it', async () => {
      const seeded = await Promise.all(
        Array.from({ length: 11 }, () => seed()),
      );
      await bulk('manager', {}).expect(403).expect(errorCode('forbidden'));
      expect(await api.submissions.countDocuments({ status: 'QU' })).toBe(0);
      expect(dataOf(await bulk('lot', {}).expect(200))).toEqual({
        count: 11,
        dryRun: false,
        allowed: true,
      });
      expect(
        await api.submissions.countDocuments({ status: 'QU', priority: 3 }),
      ).toBe(11);
      const commanded = (await bridgeCommands(api)).flatMap((command) =>
        command.type === 'judge' ? command.submissionIds : [],
      );
      expect([...commanded].sort()).toEqual([...seeded].sort());
    });

    it('resets and commands in chunks of at most 1000 ids', async () => {
      const template = {
        user: ids.owner,
        problem: problemId,
        language: catalog.languages.cpp,
        status: 'D',
        result: 'AC',
      };
      await api.submissions.insertMany(
        Array.from({ length: 2100 }, () => template),
      );
      expect(dataOf(await bulk('lot', {}).expect(200))).toEqual({
        count: 2100,
        dryRun: false,
        allowed: true,
      });
      const sizes = (await bridgeCommands(api)).map((command) =>
        command.type === 'judge' ? command.submissionIds.length : 0,
      );
      expect(sizes.sort()).toEqual([100, 1000, 1000]);
      expect(
        await api.submissions.countDocuments({ status: 'QU', priority: 3 }),
      ).toBe(2100);
    });

    it('filters by id range, language and result; skips locked unless forced and never touches running ones', async () => {
      const first = await seed({ result: 'WA' });
      const python = await seed({
        result: 'WA',
        language: catalog.languages.python,
      });
      const accepted = await seed({ result: 'AC' });
      const locked = await seed({
        result: 'WA',
        lockedAfter: new Date(Date.now() - 1000),
      });
      const running = await seed({ status: 'G', result: null });
      const counted = async (body: object) =>
        dataOf<{ count: number }>(await bulk('manager', body).expect(200))
          .count;
      expect(
        await counted({ results: ['WA'], languages: [catalog.languages.cpp] }),
      ).toBe(1);
      expect((await row(first)).status).toBe('QU');
      expect((await row(locked)).status).toBe('D');
      expect(await counted({ idFrom: python, idTo: accepted })).toBe(2);
      expect(await counted({ results: ['WA'], force: true })).toBe(1);
      expect((await row(locked)).status).toBe('QU');
      expect((await row(running)).status).toBe('G');
    });

    it('leaves pending final-submission rows to contest judging', async () => {
      const pending = await seed({ status: 'PD', result: null });
      const finished = await seed();
      expect(dataOf(await bulk('manager', {}).expect(200))).toEqual({
        count: 1,
        dryRun: false,
        allowed: true,
      });
      expect((await row(pending)).status).toBe('PD');
      expect((await row(finished)).status).toBe('QU');
      expect(
        (await bridgeCommands(api)).flatMap((command) =>
          command.type === 'judge' ? command.submissionIds : [],
        ),
      ).toEqual([finished]);
    });
  });
});
