import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { newId, uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import type { SimilarityRunResponse } from '../src/modules/similarity/dto/similarity-run.response';
import {
  clearRateLimits,
  contestProblem,
  createContest,
} from './contest-fixtures';
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

const RUNS = '/api/internal/similarity/runs';
const LIMITS = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };

describe('similarity runs', () => {
  let api: ApiTest;
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

  beforeAll(async () => {
    api = await setupApiTest();
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
  afterAll(() => api.teardown());
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
    expect((await queue.getJobs(['waiting'])).map((job) => job.data)).toEqual([
      { runId },
    ]);
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

  it('treats a run stuck for hours as abandoned when the next start arrives', async () => {
    const { runId } = dataOf<{ runId: string }>(
      await start('editor', { problem: 'simrun' }).expect(202),
    );
    // `createdAt` is immutable through Mongoose: age the row with the driver.
    await api.similarityRuns.collection.updateOne(
      { scopeKey: `problem:${problem._id}`, active: true },
      { $set: { createdAt: new Date(Date.now() - 4 * 3_600_000) } },
    );
    await start('editor', { problem: 'simrun' }).expect(202);
    expect(await api.similarityRuns.findById(runId).lean()).toMatchObject({
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
    await authed(api.http().get(`${RUNS}/${newId()}`), sessions.editor).expect(
      404,
    );
    await authed(api.http().get(`${RUNS}/${run._id}`), sessions.outsider)
      .expect(404)
      .expect(errorCode('not_found'));
    await authed(api.http().get(`${RUNS}/not-a-uuid`), sessions.editor).expect(
      404,
    );
  });
});
