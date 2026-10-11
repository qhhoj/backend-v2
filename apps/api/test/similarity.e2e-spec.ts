import { uuidStr } from '@libs/database';
import type { Problem, SimilarityRun } from '@libs/database';
import type { SimilarityPairDetailResponse } from '../src/modules/similarity/pairs/dto/similarity-pair-detail.response';
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
import type { Queue } from 'bullmq';
import { SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import type { SimilarityRunResponse } from '../src/modules/similarity/core/dto/similarity-run.response';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from similarity-pairs.e2e-spec.ts
{
  const LIMITS = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };
  const SOURCE_LEFT = 'int main() {\n  int total = 0;\n  return total;\n}\n';
  const SOURCE_RIGHT =
    '// copied\nint main() {\n  int sum = 0;\n  return sum;\n}\n';

  describe('similarity pairs', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let problem: Problem;
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
    const pairUrl = (pairId: string) =>
      `/api/internal/similarity/pairs/${pairId}`;

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

    it('treats a run running past the deadline and its margin as abandoned', async () => {
      const run = await seedRunning({ waitedMs: 0, runningMs: 41 * MINUTE_MS });
      await start('editor', { problem: 'simrun' }).expect(202);
      expect(await api.similarityRuns.findById(run._id).lean()).toMatchObject({
        status: 'failed',
        active: false,
        error: 'abandoned',
      });
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
