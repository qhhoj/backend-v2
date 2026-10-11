import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PROBLEM_RESCORE_QUEUE, SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob, SubmissionGradedJob } from '@libs/judging';
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
  clearBridgeCommands,
  dataOf,
  seedSubmission,
  bridgeCommands,
} from './submission-fixtures';
import { errorCode, setupApiTest, TEST_ENV } from './setup';
import type { ApiTest } from './setup';
import { randomUUID } from 'node:crypto';
import { REDIS, startOfDayIn } from '@libs/common';
import { profileQueries } from '@libs/database/testing';
import type Redis from 'ioredis';
import { createContest, hoursFromNow } from './contest-fixtures';
import { recordSubmissionEvents } from '@libs/judging/testing';
import { BULK_REJUDGE_LIMIT } from '../src/modules/submissions/core/rate-limits';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from submission-detail-actions.e2e-spec.ts
{
  const SUBMISSIONS = '/api/internal/submissions';

  interface DetailBody {
    lockedAfter: string | null;
    viewer: {
      canAbort: boolean;
      canRejudge: boolean;
      canReject: boolean;
      canLock: boolean;
      canOverrideScore: boolean;
    };
  }

  const NO_ACTIONS = {
    canAbort: false,
    canRejudge: false,
    canReject: false,
    canLock: false,
    canOverrideScore: false,
  };

  describe('submission detail action flags', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let graded: Queue<SubmissionGradedJob>;
    let problemId: string;
    const ids: Record<string, string> = {};
    const sessions: Record<string, TestSession> = {};
    const seed = async (fields: Partial<Submission> = {}) =>
      (
        await seedSubmission(api, {
          user: ids.owner,
          problem: problemId,
          language: catalog.languages.cpp,
          ...fields,
        })
      )._id;
    const detailOf = async (who: string, id: string) =>
      dataOf<DetailBody>(
        await authed(
          api.http().get(`${SUBMISSIONS}/${id}`),
          sessions[who],
        ).expect(200),
      );
    const post = (who: string, path: string) =>
      authed(api.http().post(path), sessions[who]).send({});

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      graded = api.app.get(getQueueToken(SUBMISSION_GRADED_QUEUE));
      const roles: Array<[string, object]> = [
        ['owner', {}],
        ['outsider', {}],
        [
          'permitted',
          {
            permissions: [
              'judge.edit_own_problem',
              'judge.rejudge_submission',
              'judge.reject_submission',
            ],
          },
        ],
        [
          'manager',
          {
            permissions: [
              'judge.edit_own_problem',
              'judge.rejudge_submission',
              'judge.reject_submission',
              'judge.lock_submission',
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
          code: 'flags',
          authors: [ids.manager],
        })
      )._id;
    });
    beforeEach(async () => {
      await api.submissions.deleteMany({});
      await clearBridgeCommands(api);
      await graded.obliterate({ force: true });
    });

    it('tells the owner of a finished submission that no action applies', async () => {
      const id = await seed();
      expect((await detailOf('owner', id)).viewer).toEqual(NO_ACTIONS);
    });

    it('tells the owner of a queued submission it may abort, and the abort then succeeds', async () => {
      const id = await seed({ status: 'QU', result: null });
      expect((await detailOf('owner', id)).viewer).toEqual({
        ...NO_ACTIONS,
        canAbort: true,
      });
      await post('owner', `${SUBMISSIONS}/${id}/abort`).expect(204);
    });

    it('tells a problem editor with the permissions it may rejudge and reject, and the rejudge then succeeds', async () => {
      const id = await seed();
      const body = await detailOf('manager', id);
      expect(body.viewer).toEqual({
        canAbort: false,
        canRejudge: true,
        canReject: true,
        canLock: true,
        canOverrideScore: false,
      });
      expect(body.lockedAfter).toBeNull();
      await post('manager', `${SUBMISSIONS}/${id}/rejudge`).expect(204);
    });

    it('tells holders of the permissions without edit rights that no action applies', async () => {
      const id = await seed({ user: ids.permitted });
      const body = await detailOf('permitted', id);
      expect(body.viewer).toEqual(NO_ACTIONS);
      expect(body.lockedAfter).toBeNull();
      await post('permitted', `${SUBMISSIONS}/${id}/reject`).expect(403);
    });

    it('shows the lock time to editors only: the owner of a locked submission sees null', async () => {
      const lockedAfter = new Date(Date.now() - 1000);
      const id = await seed({ status: 'QU', result: null, lockedAfter });
      expect((await detailOf('owner', id)).lockedAfter).toBeNull();
      expect((await detailOf('manager', id)).lockedAfter).toBe(
        lockedAfter.toISOString(),
      );
    });

    it('echoes the lock time and withholds rejudging from a locked submission, which answers 409', async () => {
      const lockedAfter = new Date(Date.now() - 1000);
      const id = await seed({ lockedAfter });
      const body = await detailOf('manager', id);
      expect(body.lockedAfter).toBe(lockedAfter.toISOString());
      expect(body.viewer).toEqual({
        canAbort: false,
        canRejudge: false,
        canReject: true,
        canLock: true,
        canOverrideScore: false,
      });
      await post('manager', `${SUBMISSIONS}/${id}/rejudge`)
        .expect(409)
        .expect(errorCode('conflict'));
    });

    it('lets an editor with judge.lock_submission lock a submission against rejudges and unlock it again', async () => {
      const id = await seed();
      await post('manager', `${SUBMISSIONS}/${id}/lock`).expect(204);
      expect((await detailOf('manager', id)).viewer.canRejudge).toBe(false);
      await post('manager', `${SUBMISSIONS}/${id}/rejudge`).expect(409);
      await authed(
        api.http().delete(`${SUBMISSIONS}/${id}/lock`),
        sessions.manager,
      ).expect(204);
      expect((await detailOf('manager', id)).lockedAfter).toBeNull();
      await post('manager', `${SUBMISSIONS}/${id}/rejudge`).expect(204);
    });

    it('refuses a lock to someone without edit rights on the problem, with 403', async () => {
      const id = await seed();
      await post('permitted', `${SUBMISSIONS}/${id}/lock`)
        .expect(403)
        .expect(errorCode('forbidden'));
    });
  });
}

// from submissions-stats.e2e-spec.ts
{
  const STATS = '/api/internal/submissions/stats';
  interface Stats {
    judgedToday: number;
    acceptedToday: number;
    verdictsToday: { result: string; count: number }[];
    queueLength: number;
    judgesOnline: number;
    judgesTotal: number;
  }

  describe('GET /submissions/stats', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let publicProblem: string;
    let privateProblem: string;
    let user: string;
    let today: Date;
    const stats = async () =>
      dataOf<Stats>(await api.http().get(STATS).expect(200));
    const clearCache = () => api.app.get<Redis>(REDIS).del('submissions:stats');
    const row = (problem: string, fields: object) =>
      api.submissions.create({
        user,
        problem,
        language: catalog.languages.python,
        points: 0,
        casePoints: 0,
        caseTotal: 1,
        ...fields,
      });

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      publicProblem = (
        await createProblem(api, catalog, { code: 'open', isPublic: true })
      )._id;
      privateProblem = (
        await createProblem(api, catalog, { code: 'secret', isPublic: false })
      )._id;
      user = (await createUserWith(api, 'solver'))._id;
      await api.setSetting('site.timeZone', 'Asia/Ho_Chi_Minh');
      today = new Date(Date.now() - 1000);
      const yesterday = new Date(
        startOfDayIn('Asia/Ho_Chi_Minh', new Date()).getTime() - 3_600_000,
      );
      await row(publicProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: today,
        casePoints: 1,
      });
      await row(publicProblem, {
        status: 'D',
        result: 'WA',
        judgedDate: today,
      });
      await row(publicProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: yesterday,
        casePoints: 1,
      });
      await row(privateProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: today,
        casePoints: 1,
      });
      // Leak classes that must not move any count: an organization-private problem, a contest whose
      // list is hidden while it runs, and a frozen contest during its freeze.
      const orgPrivateProblem = (
        await createProblem(api, catalog, {
          code: 'orgonly',
          isPublic: true,
          isOrganizationPrivate: true,
          organizations: [randomUUID()],
        })
      )._id;
      const hiddenContest = (
        await createContest(api, { showSubmissionList: false })
      )._id;
      const frozenContest = (
        await createContest(api, {
          showSubmissionList: true,
          formatName: 'icpc',
          frozenLastMinutes: 30,
          endTime: hoursFromNow(0.1),
        })
      )._id;
      for (const hidingProblem of [
        { problem: orgPrivateProblem },
        { problem: publicProblem, contest: hiddenContest },
        { problem: publicProblem, contest: frozenContest },
      ]) {
        const { problem, ...where } = hidingProblem;
        await row(problem, {
          status: 'D',
          result: 'AC',
          judgedDate: today,
          casePoints: 1,
          ...where,
        });
        await row(problem, { status: 'QU', ...where });
      }
      await row(publicProblem, { status: 'QU' });
      await row(publicProblem, { status: 'P' });
      await row(publicProblem, { status: 'G' });
      await row(privateProblem, { status: 'QU' });
      for (let index = 0; index < 100; index++)
        await row(publicProblem, {
          status: 'D',
          result: 'AC',
          judgedDate: yesterday,
          casePoints: 1,
        });
      await api.judges.create([
        { name: 'j1', authKeyHash: 'a', online: true },
        { name: 'j2', authKeyHash: 'b', online: true },
        { name: 'j3', authKeyHash: 'c', online: false },
        { name: 'j4', authKeyHash: 'd', isDisabled: true },
        { name: 'j5', authKeyHash: 'e', isBlocked: true, online: false },
      ]);
    });
    beforeEach(clearCache);

    it('counts today only, over what a signed-out viewer may see', async () => {
      expect(await stats()).toEqual({
        judgedToday: 2,
        acceptedToday: 1,
        verdictsToday: [
          { result: 'AC', count: 1 },
          { result: 'WA', count: 1 },
        ],
        queueLength: 3,
        judgesOnline: 2,
        judgesTotal: 3,
      });
    });

    it('answers from the cache for 30 seconds', async () => {
      await stats();
      await row(publicProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: new Date(),
        casePoints: 1,
      });
      expect((await stats()).judgedToday).toBe(2);
      await clearCache();
      expect((await stats()).judgedToday).toBe(3);
    });

    it('starts the day at midnight of the site time zone', async () => {
      const zone = 'Pacific/Kiritimati';
      await api.setSetting('site.timeZone', zone);
      await clearCache();
      const start = startOfDayIn(zone, new Date());
      const before = await stats();
      await row(publicProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: new Date(start.getTime() - 1),
      });
      await clearCache();
      expect((await stats()).judgedToday).toBe(before.judgedToday);
      await row(publicProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: start,
        casePoints: 1,
      });
      await clearCache();
      expect((await stats()).judgedToday).toBe(before.judgedToday + 1);
      await api.setSetting('site.timeZone', 'Asia/Ho_Chi_Minh');
      // After 10:00 UTC both rows also fall on today in Asia/Ho_Chi_Minh: drop them so later counts do not depend on the hour.
      await api.submissions.deleteMany({
        judgedDate: { $in: [new Date(start.getTime() - 1), start] },
      });
    });

    it('reads submissions through an index and never scans the old ones', async () => {
      await clearCache();
      const operations = await profileQueries(api.db, () =>
        api.http().get(STATS).expect(200),
      );
      const onSubmissions = operations.filter(
        (operation) => operation.collection === 'submissions',
      );
      expect(onSubmissions.length).toBeGreaterThanOrEqual(2);
      for (const operation of onSubmissions) {
        expect(operation.planSummary).toContain('IXSCAN');
        expect(operation.planSummary).not.toContain('COLLSCAN');
        // 100 submissions judged yesterday must not be looked at: only today's and the queue's rows count
        expect(operation.docsExamined).toBeLessThanOrEqual(12);
      }
    });

    it('counts the verdicts of today by result, most frequent first, adding up to the judged total', async () => {
      for (const result of ['TLE', 'TLE', 'TLE', 'TLE', 'CE'])
        await row(publicProblem, {
          status: 'D',
          result,
          judgedDate: new Date(),
        });
      await clearCache();
      const day = await stats();
      // earlier tests' rows may count as today too (it depends on the hour), so the order is checked, not the leader
      expect(day.verdictsToday).toContainEqual({ result: 'TLE', count: 4 });
      const counts = day.verdictsToday.map(({ count }) => count);
      expect(counts).toEqual([...counts].sort((left, right) => right - left));
      expect(day.verdictsToday).toContainEqual({ result: 'CE', count: 1 });
      const counted = day.verdictsToday.reduce(
        (sum, { count }) => sum + count,
        0,
      );
      expect(counted).toBe(day.judgedToday);
      expect(
        day.verdictsToday.find(({ result }) => result === 'AC')?.count ?? 0,
      ).toBe(day.acceptedToday);
    });
  });
}

// from submissions-events-published.e2e-spec.ts
{
  const SUBMISSIONS = '/api/internal/submissions';

  describe('submission events published by the api', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let owner: TestSession;
    let manager: TestSession;
    let ownerId: string;
    let problemId: string;
    let recorder: Awaited<ReturnType<typeof recordSubmissionEvents>>;
    const seed = async (fields: Partial<Submission> = {}) =>
      (
        await seedSubmission(api, {
          user: ownerId,
          problem: problemId,
          language: catalog.languages.cpp,
          status: 'D',
          ...fields,
        })
      )._id;
    const eventsOf = (id: string) =>
      recorder.events
        .filter((event) => event.submissionId === id)
        .map(({ type, status }) => [type, status]);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      ownerId = (await createUserWith(api, 'owner'))._id;
      const managerId = (
        await createUserWith(api, 'manager', {
          permissions: [
            'judge.edit_own_problem',
            'judge.rejudge_submission',
            'judge.reject_submission',
            'judge.rejudge_submission_lot',
          ],
        })
      )._id;
      owner = await loginAs(api, ownerId);
      manager = await loginAs(api, managerId);
      problemId = (
        await createProblem(api, catalog, {
          code: 'events',
          authors: [managerId],
        })
      )._id;
    });
    beforeEach(async () => {
      recorder = await recordSubmissionEvents(TEST_ENV.REDIS_URL);
    });
    afterEach(() => recorder.stop());

    it('publishes queued on submit and done AB when the owner aborts it while queued', async () => {
      const { id } = dataOf<{ id: string }>(
        await authed(
          api.http().post('/api/internal/problems/events/submit'),
          owner,
        )
          .send({ language: catalog.languages.cpp, source: 'int main() {}' })
          .expect(201),
      );
      await authed(api.http().post(`${SUBMISSIONS}/${id}/abort`), owner).expect(
        204,
      );
      await recorder.waitFor(() => eventsOf(id).length === 2);
      expect(eventsOf(id)).toEqual([
        ['queued', 'QU'],
        ['done', 'AB'],
      ]);
      expect(
        recorder.events.find((event) => event.submissionId === id),
      ).toMatchObject({ userId: ownerId, problemId });
    });

    it('publishes queued on a rejudge and done on a reject', async () => {
      const rejudged = await seed();
      const rejected = await seed();
      await authed(
        api.http().post(`${SUBMISSIONS}/${rejudged}/rejudge`),
        manager,
      ).expect(204);
      await authed(
        api.http().post(`${SUBMISSIONS}/${rejected}/reject`),
        manager,
      ).expect(204);
      await recorder.waitFor(
        () =>
          eventsOf(rejudged).length === 1 && eventsOf(rejected).length === 1,
      );
      expect(eventsOf(rejudged)).toEqual([['queued', 'QU']]);
      expect(eventsOf(rejected)).toEqual([['done', 'D']]);
    });

    it('publishes nothing when aborting a running submission: the judge decides its end', async () => {
      const running = await seed({ status: 'G', judgedOn: 'judge-01' });
      await authed(
        api.http().post(`${SUBMISSIONS}/${running}/abort`),
        owner,
      ).expect(204);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(eventsOf(running)).toEqual([]);
    });

    it('publishes the actual status of a rejected submission', async () => {
      const compileError = await seed({ status: 'CE' });
      await authed(
        api.http().post(`${SUBMISSIONS}/${compileError}/reject`),
        manager,
      ).expect(204);
      await recorder.waitFor(() => eventsOf(compileError).length === 1);
      expect(eventsOf(compileError)).toEqual([['done', 'CE']]);
    });

    it('publishes nothing for a bulk rejudge', async () => {
      const ids = [await seed(), await seed()];
      await authed(api.http().post(`${SUBMISSIONS}/rejudge`), manager)
        .send({ problem: 'events' })
        .expect(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(ids.flatMap(eventsOf)).toEqual([]);
    });
  });
}

// from submission-bulk-rejudge-dry-run.e2e-spec.ts
{
  const REJUDGE_PATH = '/api/internal/submissions/rejudge';

  interface BulkRejudgeBody {
    count: number;
    dryRun: boolean;
    allowed: boolean;
    sample: Array<{ id: string }>;
  }

  describe('bulk rejudge dry run', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let graded: Queue<SubmissionGradedJob>;
    let sessions: Record<string, TestSession>;
    let owner: string;
    let problemId: string;
    const ids: Record<string, string> = {};
    const bulk = (who: string, body: object) =>
      authed(api.http().post(REJUDGE_PATH), sessions[who]).send({
        problem: 'dry',
        ...body,
      });
    const insertRows = async (
      count: number,
      fields: Record<string, unknown> = {},
    ) =>
      api.submissions.insertMany(
        Array.from({ length: count }, () => ({
          user: owner,
          problem: problemId,
          language: catalog.languages.cpp,
          status: 'D',
          result: 'AC',
          ...fields,
        })),
      );
    const statusesOf = async () =>
      (await api.submissions.find({}, { status: 1 }).lean()).map(
        (row) => row.status,
      );

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      graded = api.app.get(getQueueToken(SUBMISSION_GRADED_QUEUE));
      owner = (await createUserWith(api, 'owner', {}))._id;
      const roles: Array<[string, object]> = [
        ['outsider', {}],
        [
          'nonEditor',
          {
            permissions: ['judge.edit_own_problem', 'judge.rejudge_submission'],
          },
        ],
        [
          'manager',
          {
            permissions: ['judge.edit_own_problem', 'judge.rejudge_submission'],
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
        [
          'siteWide',
          {
            permissions: ['judge.edit_all_problem', 'judge.rejudge_submission'],
          },
        ],
        [
          'contestEditor',
          {
            permissions: ['judge.edit_own_contest', 'judge.rejudge_submission'],
          },
        ],
      ];
      sessions = {};
      for (const [name, extra] of roles) {
        ids[name] = (await createUserWith(api, name, extra))._id;
        sessions[name] = await loginAs(api, ids[name]);
      }
      problemId = (
        await createProblem(api, catalog, {
          code: 'dry',
          authors: [ids.manager, ids.lot],
        })
      )._id;
      await createProblem(api, catalog, {
        code: 'hid',
        isPublic: false,
        authors: [ids.manager],
      });
    });
    beforeEach(async () => {
      await api.submissions.deleteMany({});
      await clearBridgeCommands(api);
      await graded.obliterate({ force: true });
    });

    it('counts a dry run without resetting, commanding or publishing anything', async () => {
      await insertRows(2);
      const body = dataOf<BulkRejudgeBody>(
        await bulk('manager', { dryRun: true }).expect(200),
      );
      expect(body).toMatchObject({ count: 2, dryRun: true, allowed: true });
      expect(body.sample).toHaveLength(2);
      expect(await statusesOf()).toEqual(['D', 'D']);
      expect(await bridgeCommands(api)).toEqual([]);
      expect(await graded.getJobs(['waiting'])).toEqual([]);
    });

    it('refuses a dry run to someone without the permission or edit rights, with 403', async () => {
      await insertRows(2);
      await bulk('outsider', { dryRun: true })
        .expect(403)
        .expect(errorCode('forbidden'));
      await bulk('nonEditor', { dryRun: true })
        .expect(403)
        .expect(errorCode('forbidden'));
      expect(await statusesOf()).toEqual(['D', 'D']);
    });

    it('answers 404 to a dry run on a problem the caller cannot see', async () => {
      await insertRows(2);
      await bulk('outsider', { dryRun: true, problem: 'hid' })
        .expect(404)
        .expect(errorCode('not_found'));
    });

    it('counts exactly what the real run then resets, skipping locked, pending and running rows', async () => {
      await insertRows(2);
      await insertRows(1, { lockedAfter: new Date(Date.now() - 1000) });
      await insertRows(1, { status: 'PD', result: null });
      await insertRows(1, { status: 'P', result: null });
      const preview = dataOf<BulkRejudgeBody>(
        await bulk('manager', { dryRun: true }).expect(200),
      );
      expect(preview.count).toBe(2);
      const real = dataOf<BulkRejudgeBody>(
        await bulk('manager', {}).expect(200),
      );
      expect(real.count).toBe(preview.count);
    });

    it('answers allowed: false on a dry run above the limit, and refuses the real run with 403', async () => {
      await insertRows(BULK_REJUDGE_LIMIT + 1);
      const preview = dataOf<BulkRejudgeBody>(
        await bulk('manager', { dryRun: true }).expect(200),
      );
      expect(preview).toMatchObject({
        count: BULK_REJUDGE_LIMIT + 1,
        dryRun: true,
        allowed: false,
      });
      await bulk('manager', {}).expect(403).expect(errorCode('forbidden'));
      expect(await statusesOf()).not.toContain('QU');
      expect(await bridgeCommands(api)).toEqual([]);
    });

    it('answers allowed: true on a dry run above the limit for a holder of judge.rejudge_submission_lot', async () => {
      await insertRows(BULK_REJUDGE_LIMIT + 1);
      expect(
        dataOf<BulkRejudgeBody>(
          await bulk('lot', { dryRun: true }).expect(200),
        ),
      ).toMatchObject({
        count: BULK_REJUDGE_LIMIT + 1,
        dryRun: true,
        allowed: true,
      });
      expect(await statusesOf()).not.toContain('QU');
    });

    it('runs the real rejudge and reports what it reset', async () => {
      await insertRows(2);
      const body = dataOf<BulkRejudgeBody>(
        await bulk('manager', {}).expect(200),
      );
      expect(body).toEqual({
        count: 2,
        dryRun: false,
        allowed: true,
        sample: [],
      });
      expect(await statusesOf()).toEqual(['QU', 'QU']);
      expect(await bridgeCommands(api)).toHaveLength(1);
    });

    it('logs a real run with who ran it, and lists it as a recent batch', async () => {
      await insertRows(1);
      await bulk('manager', { results: ['AC'] }).expect(200);
      const recent = dataOf<
        Array<{ action: string; count: number; filter: object; user: object }>
      >(
        await authed(
          api
            .http()
            .get(`${REJUDGE_PATH.replace('rejudge', 'batches/recent')}`),
          sessions.manager,
        ).expect(200),
      );
      expect(recent[0]).toMatchObject({
        action: 'rejudge',
        count: 1,
        filter: { problem: 'dry', results: ['AC'] },
        user: { username: 'manager' },
      });
    });

    it('needs judge.edit_all_problem for a batch with no problem or contest', async () => {
      await insertRows(1);
      await authed(api.http().post(REJUDGE_PATH), sessions.manager)
        .send({ dryRun: true })
        .expect(403)
        .expect(errorCode('forbidden'));
      const body = dataOf<BulkRejudgeBody>(
        await authed(api.http().post(REJUDGE_PATH), sessions.siteWide)
          .send({ dryRun: true, user: 'owner' })
          .expect(200),
      );
      expect(body.count).toBe(1);
    });

    it("lets a contest's editor rejudge its submissions only, and refuses a non-editor", async () => {
      const contest = await createContest(api, {
        authors: [ids.contestEditor],
      });
      await insertRows(1, { contest: contest._id });
      await insertRows(2);
      const body = dataOf<BulkRejudgeBody>(
        await bulk('contestEditor', {
          contest: contest.key,
          dryRun: true,
        }).expect(200),
      );
      expect(body.count).toBe(1);
      await bulk('manager', { contest: contest.key, dryRun: true })
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('filters by the judge that graded the submissions', async () => {
      await insertRows(2, { judgedOn: 'alpha' });
      await insertRows(1, { judgedOn: 'beta' });
      const body = dataOf<BulkRejudgeBody>(
        await bulk('manager', { judgedOn: 'alpha', dryRun: true }).expect(200),
      );
      expect(body.count).toBe(2);
    });
  });
}

// Bulk rescore
{
  const RESCORE_PATH = '/api/internal/submissions/rescore';

  describe('bulk rescore', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let rescores: Queue<ProblemRescoreJob>;
    let manager: TestSession;
    let problemId: string;

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      rescores = api.app.get(getQueueToken(PROBLEM_RESCORE_QUEUE));
      const managerId = (
        await createUserWith(api, 'manager', {
          permissions: ['judge.edit_own_problem', 'judge.rejudge_submission'],
        })
      )._id;
      manager = await loginAs(api, managerId);
      problemId = (
        await createProblem(api, catalog, {
          code: 'resc',
          authors: [managerId],
        })
      )._id;
      await api.submissions.insertMany(
        ['D', 'D', 'QU'].map((status) => ({
          user: managerId,
          problem: problemId,
          language: catalog.languages.cpp,
          status,
        })),
      );
    });

    it('counts finished matches on a dry run and queues one problem rescore on a real run', async () => {
      await rescores.obliterate({ force: true });
      const send = (body: object) =>
        authed(api.http().post(RESCORE_PATH), manager).send({
          problem: 'resc',
          ...body,
        });
      expect(dataOf(await send({ dryRun: true }).expect(200))).toEqual({
        count: 2,
        problems: 1,
        contests: 0,
        dryRun: true,
      });
      expect(await rescores.getJobs(['waiting'])).toEqual([]);
      await send({}).expect(200);
      const jobs = await rescores.getJobs(['waiting']);
      expect(jobs.map((job) => job.data)).toEqual([{ problemId }]);
    });
  });
}
