import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import type { Submission } from '@libs/database';
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
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

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
    it('lets the owner abort a queued submission: AB at once, graded, and the bridge told', async () => {
      const id = await seed({ status: 'QU', result: null });
      await post('owner', `${SUBMISSIONS}/${id}/abort`).expect(204);
      expect(await row(id)).toMatchObject({
        status: 'AB',
        result: 'AB',
        points: 0,
      });
      expect(await gradedIds()).toEqual([id]);
      expect(await bridgeCommands(api)).toEqual([
        { type: 'abort', submissionId: id },
      ]);
    });

    it('leaves a running submission to the bridge, which terminates it', async () => {
      const id = await seed({ status: 'G', result: null, judgedOn: 'judge-1' });
      await post('aborter', `${SUBMISSIONS}/${id}/abort`).expect(204);
      expect(await row(id)).toMatchObject({ status: 'G' });
      expect(await gradedIds()).toEqual([]);
      expect(await bridgeCommands(api)).toEqual([
        { type: 'abort', submissionId: id },
      ]);
    });

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

    it('does nothing to a finished submission', async () => {
      const id = await seed();
      await post('owner', `${SUBMISSIONS}/${id}/abort`).expect(204);
      expect(await row(id)).toMatchObject({ status: 'D', result: 'AC' });
      expect(await bridgeCommands(api)).toEqual([]);
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
        error: 'OLD LOG',
        judgedOn: 'judge-9',
        judgedDate: new Date(),
        memory: 123,
        currentTestcase: 4,
        batch: true,
        isPretested: true,
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
        error: null,
        judgedOn: null,
        judgedDate: null,
        memory: null,
        caseTotal: 0,
        currentTestcase: 0,
        batch: false,
        isPretested: false,
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
      });
      expect(await gradedIds()).toEqual([id]);
      const queued = await seed({ status: 'QU', result: null });
      await post('manager', `${SUBMISSIONS}/${queued}/reject`).expect(409);
      await post('owner', `${SUBMISSIONS}/${id}/reject`).expect(403);
    });

    it('answers 404 for unknown and malformed ids', async () => {
      for (const action of ['abort', 'rejudge', 'reject'])
        for (const id of ['0192b0e0-0000-7000-8000-00000000dead', 'nope'])
          await post('manager', `${SUBMISSIONS}/${id}/${action}`).expect(404);
    });
  });

  describe('visibility and permissions', () => {
    it('answers 404 on a private problem to everyone who cannot see it, owner included', async () => {
      const hidden = (await api.problems.findOne({ code: 'hidden' }))!._id;
      const id = await seed({ problem: hidden });
      for (const who of ['owner', 'other', 'aborter', 'lot'])
        for (const action of ['abort', 'rejudge', 'reject'])
          await post(who, `${SUBMISSIONS}/${id}/${action}`).expect(404);
      expect((await row(id)).status).toBe('D');
    });

    it('needs the permission of each action on top of edit rights', async () => {
      const id = await seed();
      await post('editor', `${SUBMISSIONS}/${id}/rejudge`).expect(403);
      await post('editor', `${SUBMISSIONS}/${id}/reject`).expect(403);
      await post('lot', `${SUBMISSIONS}/${id}/reject`).expect(403);
      await post('editor', `${SUBMISSIONS}/rejudge`, {
        problem: 'acts',
      }).expect(403);
      expect(await row(id)).toMatchObject({ status: 'D', result: 'AC' });
    });

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
      expect(dataOf(await bulk('lot', {}).expect(200))).toEqual({ count: 11 });
      expect(
        await api.submissions.countDocuments({ status: 'QU', priority: 3 }),
      ).toBe(11);
      const commanded = (await bridgeCommands(api)).flatMap((command) =>
        command.type === 'judge' ? command.submissionIds : [],
      );
      expect([...commanded].sort()).toEqual([...seeded].sort());
    });

    it('allows exactly 10 submissions without the lot permission', async () => {
      await Promise.all(Array.from({ length: 10 }, () => seed()));
      expect(dataOf(await bulk('manager', {}).expect(200))).toEqual({
        count: 10,
      });
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

    it('rejects the nil and max UUIDs, which Mongoose cannot cast, with 400', async () => {
      for (const unusable of [NIL_UUID, MAX_UUID]) {
        for (const body of [
          { idFrom: unusable },
          { idTo: unusable },
          { languages: [unusable] },
        ])
          await bulk('lot', body)
            .expect(400)
            .expect(errorCode('validation_failed'));
      }
    });

    it('needs edit rights on the problem and a visible problem', async () => {
      await seed();
      await bulk('outsider', {}).expect(403);
      await post('lot', `${SUBMISSIONS}/rejudge`, { problem: 'nope' }).expect(
        404,
      );
      await post('lot', `${SUBMISSIONS}/rejudge`, {})
        .expect(400)
        .expect(errorCode('validation_failed'));
    });
  });
});
