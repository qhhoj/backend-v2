import { newId, uuidStr } from '@libs/database';
import type { Problem, SimilarityRun } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { SimilarityPairDetailResponse } from '../src/modules/similarity/pairs/dto/similarity-pair-detail.response';
import type { SimilarityPairResponse } from '../src/modules/similarity/pairs/dto/similarity-pair.response';
import {
  contestProblem,
  createContest,
  clearRateLimits,
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
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import type { SimilarityRunResponse } from '../src/modules/similarity/core/dto/similarity-run.response';
import { SimilarityRunsRepository } from '../src/modules/similarity/core/similarity-runs.repository';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from similarity-pairs.e2e-spec.ts
{
  interface PairPage {
    data: SimilarityPairResponse[];
    meta: { page: number; pageSize: number; total: number };
  }

  const LIMITS = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };
  const SOURCE_LEFT = 'int main() {\n  int total = 0;\n  return total;\n}\n';
  const SOURCE_RIGHT =
    '// copied\nint main() {\n  int sum = 0;\n  return sum;\n}\n';

  describe('similarity pairs', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let problem: Problem;
    let otherProblem: Problem;
    let privateProblem: Problem;
    let run: SimilarityRun;
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const roles: Record<string, string[]> = {
      // Author of both problems and of the contest below.
      editor: [
        'judge.moss_contest',
        'judge.edit_own_problem',
        'judge.edit_own_contest',
      ],
      // The permission and edit rights in general, but nobody's author.
      outsider: [
        'judge.moss_contest',
        'judge.edit_own_problem',
        'judge.edit_own_contest',
      ],
      // Author of the problem, without the permission.
      unpermitted: ['judge.edit_own_problem'],
      // Curator of the contest below, not an author of the private problem.
      curator: ['judge.moss_contest', 'judge.edit_own_contest'],
      // Curator of the contest below and author of the private problem.
      owner: [
        'judge.moss_contest',
        'judge.edit_own_contest',
        'judge.edit_own_problem',
      ],
      ann: [],
      bob: [],
    };
    const get = (
      who: string,
      path: string,
      query: Record<string, unknown> = {},
    ) => authed(api.http().get(path).query(query), sessions[who]);
    const pairsOf = (runId: string) =>
      `/api/internal/similarity/runs/${runId}/pairs`;
    const pairUrl = (pairId: string) =>
      `/api/internal/similarity/pairs/${pairId}`;
    const similaritiesOf = async (query: Record<string, unknown>) =>
      (
        (await get('editor', pairsOf(run._id), query).expect(200))
          .body as PairPage
      ).data.map((pair) => pair.similarity);

    /**
     * `overrides` apply to the pair, `submissionFields` to both its submissions,
     * unless `rightFields` replaces them on the right one.
     */
    const addPair = async (
      similarity: number,
      overrides: Record<string, unknown> = {},
      submissionFields: Record<string, unknown> = {},
      rightFields: Record<string, unknown> = submissionFields,
    ) => {
      const left = await seedSubmission(api, {
        user: users.ann._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        source: SOURCE_LEFT,
        ...submissionFields,
      });
      const right = await seedSubmission(api, {
        user: users.bob._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        source: SOURCE_RIGHT,
        ...rightFields,
      });
      return api.similarityPairs.create({
        run: run._id,
        problem: problem._id,
        language: 'cpp',
        left: { submission: left._id, user: users.ann._id },
        right: { submission: right._id, user: users.bob._id },
        similarity,
        longestFragment: 9,
        totalOverlap: 20,
        fragments: [{ leftStart: 1, leftEnd: 4, rightStart: 2, rightEnd: 5 }],
        ...overrides,
      });
    };

    const seedContestRun = async (
      contestFields: Record<string, unknown> = {},
    ) => {
      const contest = await createContest(api, {
        authors: [users.editor._id],
        problems: [contestProblem(problem._id, 0)],
        ...contestFields,
      });
      return api.similarityRuns.create({
        scope: 'contest',
        scopeKey: `contest:${contest._id}`,
        contest: contest._id,
        requestedBy: users.editor._id,
        status: 'done',
        active: false,
        limits: LIMITS,
      });
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      for (const [name, permissions] of Object.entries(roles)) {
        users[name] = await createUserWith(api, name, { permissions });
        sessions[name] = await loginAs(api, users[name]._id);
      }
      problem = await createProblem(api, catalog, {
        code: 'simpair',
        authors: [users.editor._id, users.unpermitted._id],
      });
      otherProblem = await createProblem(api, catalog, {
        code: 'simother',
        authors: [users.editor._id],
      });
      privateProblem = await createProblem(api, catalog, {
        code: 'simprivate',
        isPublic: false,
        authors: [users.owner._id],
      });
    });
    beforeEach(async () => {
      await api.similarityPairs.deleteMany({});
      await api.similarityRuns.deleteMany({});
      run = await api.similarityRuns.create({
        scope: 'problem',
        scopeKey: `problem:${problem._id}`,
        problem: problem._id,
        requestedBy: users.editor._id,
        status: 'done',
        active: false,
        limits: LIMITS,
      });
    });

    it('answers 401 and 403 before showing anything', async () => {
      const pair = await addPair(0.9);
      await api.http().get(pairsOf(run._id)).expect(401);
      await api.http().get(pairUrl(pair._id)).expect(401);
      await get('unpermitted', pairsOf(run._id))
        .expect(403)
        .expect(errorCode('forbidden'));
      await get('unpermitted', pairUrl(pair._id)).expect(403);
    });

    it('hides the pair list from a viewer who does not edit the scope', async () => {
      await addPair(0.9);
      await get('outsider', pairsOf(run._id))
        .expect(404)
        .expect(errorCode('not_found'));
    });

    it('hides the pair detail and its sources from a viewer who does not edit the scope', async () => {
      const pair = await addPair(0.9);
      await get('outsider', pairUrl(pair._id))
        .expect(404)
        .expect(errorCode('not_found'));
    });

    it('answers 404 for the pair detail of a deleted problem', async () => {
      const pair = await addPair(0.9);
      await get('editor', pairUrl(pair._id)).expect(200);
      await api.problems.updateOne(
        { _id: problem._id },
        { $set: { deletedAt: new Date() } },
      );
      try {
        await get('editor', pairUrl(pair._id))
          .expect(404)
          .expect(errorCode('not_found'));
      } finally {
        await api.problems.updateOne(
          { _id: problem._id },
          { $unset: { deletedAt: '' } },
        );
      }
    });

    it('answers 404 for unknown and malformed ids', async () => {
      await get('editor', pairsOf(newId())).expect(404);
      await get('editor', pairsOf('not-a-uuid')).expect(404);
      await get('editor', pairUrl(newId())).expect(404);
      await get('editor', pairUrl('not-a-uuid')).expect(404);
    });

    it('lists pairs best first, paged, with usernames and the problem code', async () => {
      for (const similarity of [0.55, 0.97, 0.7, 0.81])
        await addPair(similarity);
      const first = (
        await get('editor', pairsOf(run._id), { page: 1, pageSize: 3 }).expect(
          200,
        )
      ).body as PairPage;
      expect(first.data.map((pair) => pair.similarity)).toEqual([
        0.97, 0.81, 0.7,
      ]);
      expect(first.meta).toEqual({ page: 1, pageSize: 3, total: 4 });
      expect(first.data[0]).toMatchObject({
        problemCode: 'simpair',
        language: 'cpp',
        fragmentCount: 1,
        left: { username: 'ann', userId: users.ann._id },
        right: { username: 'bob', userId: users.bob._id },
      });
      const second = (
        await get('editor', pairsOf(run._id), { page: 2, pageSize: 3 }).expect(
          200,
        )
      ).body as PairPage;
      expect(second.data.map((pair) => pair.similarity)).toEqual([0.55]);
    });

    it('bounds the page size', async () => {
      await get('editor', pairsOf(run._id), { pageSize: 101 })
        .expect(400)
        .expect(errorCode('validation_failed'));
    });

    it('filters by problem, language and minimum similarity', async () => {
      await addPair(0.9);
      await addPair(0.6, { language: 'python' });
      await addPair(0.8, { problem: otherProblem._id });
      expect(await similaritiesOf({ language: 'python' })).toEqual([0.6]);
      expect(await similaritiesOf({ problemId: otherProblem._id })).toEqual([
        0.8,
      ]);
      expect(await similaritiesOf({ minSimilarity: 0.85 })).toEqual([0.9]);
      expect(
        await similaritiesOf({ problemId: problem._id, language: 'cpp' }),
      ).toEqual([0.9]);
      await get('editor', pairsOf(run._id), { minSimilarity: 2 })
        .expect(400)
        .expect(errorCode('validation_failed'));
    });

    it('reads a page through the pair indexes without scanning the collection', async () => {
      for (let index = 0; index < 30; index++) await addPair(0.5 + index / 100);
      await api.similarityPairs.syncIndexes();
      const operations = await profileQueries(api.db, async () => {
        await get('editor', pairsOf(run._id), { pageSize: 10 }).expect(200);
        await get('editor', pairsOf(run._id), {
          pageSize: 10,
          language: 'cpp',
          problemId: problem._id,
        }).expect(200);
      });
      const pairReads = operations.filter(
        (operation) => operation.collection === 'similarityPairs',
      );
      expect(pairReads.length).toBeGreaterThan(0);
      for (const operation of pairReads) {
        expect(operation.planSummary).not.toContain('COLLSCAN');
        expect(operation.hasSortStage).toBe(false);
        expect(operation.docsExamined).toBeLessThanOrEqual(40);
      }
    });

    it('shows both sources with their fragment ranges to the scope editor', async () => {
      const pair = await addPair(0.93);
      const detail = dataOf<SimilarityPairDetailResponse>(
        await get('editor', pairUrl(pair._id)).expect(200),
      );
      expect(detail).toMatchObject({
        id: pair._id,
        runId: run._id,
        problemCode: 'simpair',
        similarity: 0.93,
        longestFragment: 9,
        totalOverlap: 20,
        left: { username: 'ann', source: SOURCE_LEFT, result: 'AC' },
        right: { username: 'bob', source: SOURCE_RIGHT },
        fragments: [{ leftStart: 1, leftEnd: 4, rightStart: 2, rightEnd: 5 }],
      });
      expect(detail.left.submissionId).toBe(uuidStr(pair.left.submission));
      // The ranges lie inside the sources they describe.
      const lines = (source: string) => source.trimEnd().split('\n').length;
      for (const fragment of detail.fragments) {
        expect(fragment.leftEnd).toBeLessThanOrEqual(lines(detail.left.source));
        expect(fragment.rightEnd).toBeLessThanOrEqual(
          lines(detail.right.source),
        );
      }
    });

    it('shows a contest run and its pairs to the contest editor only', async () => {
      const contestRun = await seedContestRun();
      const pair = await addPair(0.9, { run: contestRun._id });
      await get('editor', pairsOf(contestRun._id)).expect(200);
      await get('editor', pairUrl(pair._id)).expect(200);
      await get('outsider', pairsOf(contestRun._id)).expect(404);
      await get('outsider', pairUrl(pair._id)).expect(404);
    });

    describe('in a contest with a private problem', () => {
      let contestRun: SimilarityRun;
      let publicPair: { _id: string };
      let privatePair: { _id: string };
      const idsListedFor = async (who: string) =>
        (
          (await get(who, pairsOf(contestRun._id)).expect(200)).body as PairPage
        ).data.map((pair) => pair.id);

      beforeEach(async () => {
        contestRun = await seedContestRun({
          curators: [users.curator._id, users.owner._id],
          problems: [
            contestProblem(problem._id, 0),
            contestProblem(privateProblem._id, 1),
          ],
        });
        const inContest = { contest: contestRun.contest };
        publicPair = await addPair(0.7, { run: contestRun._id }, inContest);
        privatePair = await addPair(
          0.9,
          { run: contestRun._id, problem: privateProblem._id },
          { ...inContest, problem: privateProblem._id },
        );
      });

      it('leaves the private problem out of the list for a curator who cannot see it', async () => {
        expect(await idsListedFor('curator')).toEqual([publicPair._id]);
      });

      it('hides the private problem pair from a curator who cannot see it', async () => {
        await get('curator', pairUrl(privatePair._id))
          .expect(404)
          .expect(errorCode('not_found'));
        await get('curator', pairUrl(publicPair._id)).expect(200);
      });

      it("shows the private problem pair to the problem's author", async () => {
        expect(await idsListedFor('owner')).toEqual([
          privatePair._id,
          publicPair._id,
        ]);
        await get('owner', pairUrl(privatePair._id)).expect(200);
      });

      it('still hides the private problem pair once both submissions are gone', async () => {
        await api.submissions.deleteMany({});
        await get('curator', pairUrl(privatePair._id)).expect(404);
        await get('owner', pairUrl(privatePair._id)).expect(200);
      });

      it('hides a pair when the source route would hide either side', async () => {
        // A practice submission: being the contest's curator grants nothing on it.
        const inContest = { contest: contestRun.contest };
        const practice = { contest: null };
        const pairs = [
          await addPair(0.8, { run: contestRun._id }, practice, inContest),
          await addPair(0.8, { run: contestRun._id }, inContest, practice),
        ];
        for (const pair of pairs)
          await get('curator', pairUrl(pair._id))
            .expect(404)
            .expect(errorCode('not_found'));
      });

      it('hides sources that the source route would hide', async () => {
        // Submitted outside the contest: being its curator grants nothing on them.
        const practicePair = await addPair(0.8, { run: contestRun._id });
        await get('curator', pairUrl(practicePair._id))
          .expect(404)
          .expect(errorCode('not_found'));
      });
    });

    it('keeps working when a submission or its source has been deleted', async () => {
      const pair = await addPair(0.9);
      await api.submissionSources.deleteOne({
        _id: uuidStr(pair.left.submission),
      });
      const detail = dataOf<SimilarityPairDetailResponse>(
        await get('editor', pairUrl(pair._id)).expect(200),
      );
      expect(detail.left.source).toBe('');
      await api.submissions.deleteOne({ _id: uuidStr(pair.right.submission) });
      const withoutSubmission = dataOf<SimilarityPairDetailResponse>(
        await get('editor', pairUrl(pair._id)).expect(200),
      );
      expect(withoutSubmission.right).toMatchObject({
        date: null,
        result: null,
        points: null,
      });
    });
  });
}

// from similarity-runs.e2e-spec.ts
{
  const RUNS = '/api/internal/similarity/runs';
  const LIMITS = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };
  const MINUTE_MS = 60_000;
  const HOUR_MS = 60 * MINUTE_MS;

  describe('similarity runs', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let queue: Queue<SimilarityJob>;
    let problem: Problem;
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const roles: Record<string, string[]> = {
      // Author of the problem below.
      editor: [
        'judge.moss_contest',
        'judge.edit_own_problem',
        'judge.edit_own_contest',
      ],
      // The permission and edit rights in general, but nobody's author.
      outsider: [
        'judge.moss_contest',
        'judge.edit_own_problem',
        'judge.edit_own_contest',
      ],
      // Author of the problem, without the permission.
      unpermitted: ['judge.edit_own_problem', 'judge.edit_own_contest'],
    };
    const start = (who: string, body: object) =>
      authed(api.http().post(RUNS).send(body), sessions[who]);
    const deactivateRuns = () =>
      api.similarityRuns.updateMany({}, { active: false, status: 'done' });
    const seedRun = (fields: Record<string, unknown> = {}) =>
      api.similarityRuns.create({
        scope: 'problem',
        scopeKey: `problem:${problem._id}`,
        problem: problem._id,
        requestedBy: users.editor._id,
        status: 'done',
        active: false,
        limits: LIMITS,
        ...fields,
      });

    /** An active run claimed `runningMs` ago after `waitedMs` in the queue; `createdAt` is immutable through Mongoose, so the driver ages it. */
    const seedRunning = async (age: {
      waitedMs: number;
      runningMs: number;
    }) => {
      const run = await seedRun({ status: 'running', active: true });
      const startedAt = new Date(Date.now() - age.runningMs);
      await api.similarityRuns.collection.updateOne(
        { scopeKey: run.scopeKey, active: true },
        {
          $set: {
            startedAt,
            createdAt: new Date(startedAt.getTime() - age.waitedMs),
          },
        },
      );
      return run;
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      queue = api.app.get(getQueueToken(SIMILARITY_QUEUE));
      for (const [name, permissions] of Object.entries(roles)) {
        users[name] = await createUserWith(api, name, { permissions });
        sessions[name] = await loginAs(api, users[name]._id);
      }
      problem = await createProblem(api, catalog, {
        code: 'simrun',
        authors: [users.editor._id, users.unpermitted._id],
      });
    });
    beforeEach(async () => {
      jest.restoreAllMocks();
      await queue.obliterate({ force: true });
      await api.similarityRuns.deleteMany({});
      await clearRateLimits(api);
    });

    it('answers 401 to anonymous callers on every route', async () => {
      await api.http().post(RUNS).send({ problem: 'simrun' }).expect(401);
      await api.http().get(RUNS).query({ problem: 'simrun' }).expect(401);
      await api.http().get(`${RUNS}/${newId()}`).expect(401);
    });

    it('answers 403 without judge.moss_contest, even to the problem editor', async () => {
      await start('unpermitted', { problem: 'simrun' })
        .expect(403)
        .expect(errorCode('forbidden'));
      await authed(
        api.http().get(RUNS).query({ problem: 'simrun' }),
        sessions.unpermitted,
      ).expect(403);
      expect(await api.similarityRuns.countDocuments()).toBe(0);
      const run = await seedRun();
      await authed(
        api.http().get(`${RUNS}/${run._id}`),
        sessions.unpermitted,
      ).expect(403);
    });

    it('answers 404 for unknown scopes and for scopes the viewer cannot edit', async () => {
      await start('editor', { problem: 'no_such_problem' })
        .expect(404)
        .expect(errorCode('not_found'));
      await start('editor', { contest: 'no_such_contest' }).expect(404);
      await start('outsider', { problem: 'simrun' })
        .expect(404)
        .expect(errorCode('not_found'));
      const contest = await createContest(api, {
        authors: [users.unpermitted._id],
      });
      await start('outsider', { contest: contest.key }).expect(404);
      await authed(
        api.http().get(RUNS).query({ problem: 'simrun' }),
        sessions.outsider,
      ).expect(404);
      expect(await queue.count()).toBe(0);
    });

    it('wants exactly one of problem and contest', async () => {
      await start('editor', {})
        .expect(400)
        .expect(errorCode('validation_failed'));
      await start('editor', { problem: 'simrun', contest: 'whatever' })
        .expect(400)
        .expect(errorCode('validation_failed'));
    });

    it('queues only the run id and snapshots the limits settings', async () => {
      await api.setSetting('similarity.maxPairs', 77);
      await api.setSetting('similarity.minPercent', 60);
      const { runId } = dataOf<{ runId: string }>(
        await start('editor', { problem: 'simrun' }).expect(202),
      );
      expect((await queue.getJobs(['waiting'])).map((job) => job.data)).toEqual(
        [{ runId }],
      );
      const stored = await api.similarityRuns.findById(runId).lean();
      expect(stored).toMatchObject({
        scope: 'problem',
        scopeKey: `problem:${problem._id}`,
        status: 'queued',
        active: true,
        limits: { minPercent: 60, maxPairs: 77, maxSubmissions: 3000 },
      });
      expect(uuidStr(stored!.requestedBy)).toBe(users.editor._id);
    });

    it('allows one active run per scope, and another once it ends', async () => {
      await start('editor', { problem: 'simrun' }).expect(202);
      await start('editor', { problem: 'simrun' })
        .expect(409)
        .expect(errorCode('conflict'));
      expect(await queue.count()).toBe(1);
      expect(await api.similarityRuns.countDocuments()).toBe(1);
      await deactivateRuns();
      await start('editor', { problem: 'simrun' }).expect(202);
    });

    it('gives the start back when the scope is busy or the job cannot be queued', async () => {
      jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('redis down'));
      await start('editor', { problem: 'simrun' }).expect(500);
      await start('editor', { problem: 'simrun' }).expect(202);
      for (let attempt = 0; attempt < 3; attempt++)
        await start('editor', { problem: 'simrun' }).expect(409);
      await deactivateRuns();
      // One start counted so far: nine more fit the limit of ten.
      for (let attempt = 0; attempt < 9; attempt++) {
        await start('editor', { problem: 'simrun' }).expect(202);
        await deactivateRuns();
      }
      await start('editor', { problem: 'simrun' }).expect(429);
    });

    it('frees the scope and logs when the unqueued run cannot be removed', async () => {
      jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('redis down'));
      const deleteError = new Error('mongo blip');
      jest
        .spyOn(api.app.get(SimilarityRunsRepository), 'deleteRun')
        .mockRejectedValueOnce(deleteError);
      const logError = jest.spyOn(Logger.prototype, 'error');
      await start('editor', { problem: 'simrun' }).expect(500);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('Deleting unqueued run'),
        deleteError,
      );
      expect(await api.similarityRuns.findOne().lean()).toMatchObject({
        status: 'failed',
        active: false,
        error: 'internal_error',
      });
      await start('editor', { problem: 'simrun' }).expect(202);
    });

    it('treats a run queued for hours as abandoned when the next start arrives', async () => {
      const { runId } = dataOf<{ runId: string }>(
        await start('editor', { problem: 'simrun' }).expect(202),
      );
      // `createdAt` is immutable through Mongoose: age the row with the driver.
      await api.similarityRuns.collection.updateOne(
        { scopeKey: `problem:${problem._id}`, active: true },
        { $set: { createdAt: new Date(Date.now() - 4 * HOUR_MS) } },
      );
      await start('editor', { problem: 'simrun' }).expect(202);
      expect(await api.similarityRuns.findById(runId).lean()).toMatchObject({
        status: 'failed',
        active: false,
        error: 'abandoned',
      });
    });

    it('keeps a run that waited hours in the queue but started a minute ago', async () => {
      const run = await seedRunning({
        waitedMs: 4 * HOUR_MS,
        runningMs: MINUTE_MS,
      });
      await start('editor', { problem: 'simrun' }).expect(409);
      expect(await api.similarityRuns.findById(run._id).lean()).toMatchObject({
        status: 'running',
        active: true,
      });
    });

    it('treats a run running past the deadline and its margin as abandoned', async () => {
      const run = await seedRunning({ waitedMs: 0, runningMs: 41 * MINUTE_MS });
      await start('editor', { problem: 'simrun' }).expect(202);
      expect(await api.similarityRuns.findById(run._id).lean()).toMatchObject({
        status: 'failed',
        active: false,
        error: 'abandoned',
      });
    });

    it('limits starts per user', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        await start('editor', { problem: 'simrun' }).expect(202);
        await deactivateRuns();
      }
      await start('editor', { problem: 'simrun' })
        .expect(429)
        .expect(errorCode('rate_limited'));
    });

    it('removes the run again when it cannot be queued, so the scope is not blocked', async () => {
      jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('redis down'));
      await start('editor', { problem: 'simrun' }).expect(500);
      expect(await api.similarityRuns.countDocuments()).toBe(0);
      await start('editor', { problem: 'simrun' }).expect(202);
    });

    it('starts a contest run for the contest editor', async () => {
      const contest = await createContest(api, {
        authors: [users.editor._id],
        problems: [contestProblem(problem._id, 0)],
      });
      const { runId } = dataOf<{ runId: string }>(
        await start('editor', { contest: contest.key }).expect(202),
      );
      expect(await api.similarityRuns.findById(runId).lean()).toMatchObject({
        scope: 'contest',
        scopeKey: `contest:${contest._id}`,
      });
    });

    it("lists a scope's runs newest first and shows a run with its group summary", async () => {
      const older = await seedRun({
        groups: [
          {
            problem: problem._id,
            language: 'cpp',
            tokenizer: 'syntax',
            submissionCount: 40,
            comparedCount: 38,
            skippedEmpty: 1,
            skippedTooLarge: 1,
            truncated: false,
            pairCount: 3,
          },
        ],
        unsupported: [{ language: 'Kotlin', submissionCount: 2 }],
      });
      const newer = await seedRun({ status: 'failed', error: 'deadline' });
      const list = dataOf<SimilarityRunResponse[]>(
        await authed(
          api.http().get(RUNS).query({ problem: 'simrun' }),
          sessions.editor,
        ).expect(200),
      );
      expect(list.map((run) => run.id)).toEqual([newer._id, older._id]);
      expect(list[0]).toMatchObject({
        status: 'failed',
        error: 'deadline',
        scope: 'problem',
      });
      const detail = dataOf<SimilarityRunResponse>(
        await authed(
          api.http().get(`${RUNS}/${older._id}`),
          sessions.editor,
        ).expect(200),
      );
      expect(detail.groups[0]).toMatchObject({
        problemCode: 'simrun',
        language: 'cpp',
        submissionCount: 40,
        skippedEmpty: 1,
        pairCount: 3,
      });
      expect(detail.unsupported).toEqual([
        { language: 'Kotlin', submissionCount: 2 },
      ]);
      expect(detail.limits).toEqual(LIMITS);
    });

    it('answers 404 for an unknown run and for a run of a scope the viewer cannot edit', async () => {
      const run = await seedRun();
      await authed(
        api.http().get(`${RUNS}/${newId()}`),
        sessions.editor,
      ).expect(404);
      await authed(api.http().get(`${RUNS}/${run._id}`), sessions.outsider)
        .expect(404)
        .expect(errorCode('not_found'));
      await authed(
        api.http().get(`${RUNS}/not-a-uuid`),
        sessions.editor,
      ).expect(404);
    });

    it('shows a contest run and its list to the contest editor only', async () => {
      const contest = await createContest(api, {
        authors: [users.editor._id],
        problems: [contestProblem(problem._id, 0)],
      });
      const run = await seedRun({
        scope: 'contest',
        scopeKey: `contest:${contest._id}`,
        problem: null,
        contest: contest._id,
      });
      const listOf = (who: string) =>
        authed(
          api.http().get(RUNS).query({ contest: contest.key }),
          sessions[who],
        );
      const detailOf = (who: string) =>
        authed(api.http().get(`${RUNS}/${run._id}`), sessions[who]);
      await listOf('outsider').expect(404).expect(errorCode('not_found'));
      await detailOf('outsider').expect(404).expect(errorCode('not_found'));
      const list = dataOf<SimilarityRunResponse[]>(
        await listOf('editor').expect(200),
      );
      expect(list.map((entry) => entry.id)).toEqual([run._id]);
      const detail = dataOf<SimilarityRunResponse>(
        await detailOf('editor').expect(200),
      );
      expect(detail).toMatchObject({
        scope: 'contest',
        contestId: contest._id,
      });
    });
  });
}
