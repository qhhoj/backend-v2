import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { uuidStr } from '@libs/database';
import {
  PROBLEM_PURGE_QUEUE,
  PROBLEM_SOLVERS_QUEUE,
  problemPurgeJobId,
} from '@libs/problems';
import type { ProblemPurgeJob, ProblemSolversJob } from '@libs/problems';
import type { DeletedProblemResponse } from '../src/modules/problems/lifecycle/dto/deleted-problem.response';
import { ContributionPointsService } from '../src/modules/contributions/contribution-points.service';
import { ContestsRepository } from '../src/modules/contests/core/contests.repository';
import {
  clearRateLimits,
  contestProblem,
  createContest,
} from './contest-fixtures';
import { tombstone } from './deleted-problem-fixtures';
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

const PROBLEMS = '/api/internal/problems';
const DELETE_RIGHTS = ['judge.delete_problem', 'judge.edit_own_problem'];

describe('problem delete, restore and purge-now', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let solvers: Queue<ProblemSolversJob>;
  let purges: Queue<ProblemPurgeJob>;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  let sequence = 0;
  const newUser = async (name: string, extra: object) => {
    ids[name] = (await createUserWith(api, name, extra))._id;
    sessions[name] = await loginAs(api, ids[name]);
  };
  const owned = (extra: object = {}) => {
    sequence += 1;
    return createProblem(api, catalog, {
      code: `lc${sequence}`,
      authors: [ids.owner],
      isPublic: false,
      ...extra,
    });
  };
  const remove = (who: string, code: string, confirmCode: string = code) =>
    authed(api.http().delete(`${PROBLEMS}/${code}`), sessions[who]).send({
      confirmCode,
    });
  const post = (who: string, code: string, action: string, body: object = {}) =>
    authed(
      api.http().post(`${PROBLEMS}/${code}/${action}`),
      sessions[who],
    ).send(body);
  const reasons = async () =>
    (await solvers.getJobs(['waiting'])).map((job) => [
      job.data.problemId,
      job.data.reason,
    ]);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    solvers = api.app.get(getQueueToken(PROBLEM_SOLVERS_QUEUE));
    purges = api.app.get(getQueueToken(PROBLEM_PURGE_QUEUE));
    await newUser('owner', { permissions: DELETE_RIGHTS });
    await newUser('author_only', { permissions: ['judge.edit_own_problem'] });
    await newUser('stranger', { permissions: ['judge.delete_problem'] });
    await newUser('root', { isSuperuser: true });
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await clearRateLimits(api);
    await solvers.obliterate({ force: true });
    await purges.obliterate({ force: true });
  });

  it('needs judge.delete_problem, then edit rights, and hides a private problem from a stranger', async () => {
    const problem = await owned();
    await remove('author_only', problem.code).expect(403);
    await remove('stranger', problem.code).expect(404);
    const publicProblem = await owned({ isPublic: true, authors: [] });
    await remove('stranger', publicProblem.code).expect(403);
    await remove('owner', problem.code).expect(204);
  });

  it('refuses a wrong confirmation code and a problem that is in a contest', async () => {
    const typo = await owned();
    await remove('owner', typo.code, 'nope')
      .expect(400)
      .expect(errorCode('validation_failed'));
    expect(
      (await api.problems.findById(typo._id).lean())!.deletedAt,
    ).toBeUndefined();
    const used = await owned();
    await createContest(api, { problems: [contestProblem(used._id, 0)] });
    await remove('owner', used.code)
      .expect(409)
      .expect(errorCode('problem_in_contest'));
    expect(
      (await api.problems.findById(used._id).lean())!.deletedAt,
    ).toBeUndefined();
  });

  it('hides the problem at once, keeps a revision, and queues the solvers recompute', async () => {
    const problem = await owned({ isPublic: true });
    await api.http().get(`${PROBLEMS}/${problem.code}`).expect(200);
    await remove('owner', problem.code).expect(204);
    await api.http().get(`${PROBLEMS}/${problem.code}`).expect(404);
    const stored = (await api.problems.findById(problem._id).lean())!;
    expect(stored.deletedAt).toBeInstanceOf(Date);
    expect(uuidStr(stored.deletedBy)).toBe(ids.owner);
    const revisions = await api.revisions
      .find({ entity: 'problem', entityId: problem._id })
      .lean();
    expect(revisions.map((row) => row.action)).toContain('delete');
    await waitUntil(async () => (await reasons()).length === 1);
    expect(await reasons()).toEqual([[problem._id, 'deleted']]);
    await remove('owner', problem.code).expect(404);
  });

  it('lists deleted problems with the days left, only to staff who could see them', async () => {
    const problem = await owned();
    await remove('owner', problem.code).expect(204);
    const listOf = async (who: string) =>
      dataOf<DeletedProblemResponse[]>(
        await authed(
          api.http().get(`${PROBLEMS}/deleted`),
          sessions[who],
        ).expect(200),
      );
    const seen = (await listOf('owner')).find(
      (row) => row.code === problem.code,
    )!;
    expect(seen).toMatchObject({
      name: problem.name,
      daysLeft: 30,
      isPurged: false,
    });
    expect(seen.deletedBy?.username).toBe('owner');
    expect((await listOf('stranger')).map((row) => row.code)).not.toContain(
      problem.code,
    );
    await authed(
      api.http().get(`${PROBLEMS}/deleted`),
      sessions.author_only,
    ).expect(403);
    await api.setSetting('problem.deleteGraceDays', 10);
    expect(
      (await listOf('owner')).find((row) => row.code === problem.code)!
        .daysLeft,
    ).toBe(10);
    await api.setSetting('problem.deleteGraceDays', 30);
  });

  it('restores within the grace period, once, and brings the problem back', async () => {
    const problem = await owned({ isPublic: true });
    await post('owner', problem.code, 'restore')
      .expect(409)
      .expect(errorCode('not_deleted'));
    await remove('owner', problem.code).expect(204);
    await post('stranger', problem.code, 'restore').expect(403);
    const hidden = await owned();
    await remove('owner', hidden.code).expect(204);
    await post('stranger', hidden.code, 'restore').expect(404);
    await post('author_only', problem.code, 'restore').expect(403);
    await solvers.obliterate({ force: true });
    await post('owner', problem.code, 'restore').expect(204);
    await api.http().get(`${PROBLEMS}/${problem.code}`).expect(200);
    expect(
      (await api.problems.findById(problem._id).lean())!.deletedAt,
    ).toBeUndefined();
    await waitUntil(async () => (await reasons()).length === 1);
    expect(await reasons()).toEqual([[problem._id, 'restored']]);
    await post('owner', problem.code, 'restore')
      .expect(409)
      .expect(errorCode('not_deleted'));
    await post('owner', 'no_such_code', 'restore').expect(404);
  });

  it('refuses to restore a problem a purge has claimed but not finished', async () => {
    const problem = await owned();
    await remove('owner', problem.code).expect(204);
    await api.problems.updateOne(
      { _id: problem._id },
      { $set: { purgeStartedAt: new Date() } },
    );
    await post('owner', problem.code, 'restore')
      .expect(409)
      .expect(errorCode('purged'));
    expect(
      (await api.problems.findById(problem._id).lean())!.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it('undoes a delete when a contest picked the problem up in between, and counts nothing', async () => {
    const problem = await owned({ isPublic: true });
    const contests = api.app.get(ContestsRepository);
    const check = jest
      .spyOn(contests, 'isProblemInAnyContest')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await solvers.obliterate({ force: true });
    await remove('owner', problem.code)
      .expect(409)
      .expect(errorCode('problem_in_contest'));
    check.mockRestore();
    expect(
      (await api.problems.findById(problem._id).lean())!.deletedAt,
    ).toBeUndefined();
    expect(await reasons()).toEqual([]);
  });

  it("refreshes the suggester's contribution points on delete and restore", async () => {
    const problem = await owned({ isPublic: true, suggester: ids.stranger });
    const refresh = jest.spyOn(
      api.app.get(ContributionPointsService),
      'refresh',
    );
    await remove('owner', problem.code).expect(204);
    await post('owner', problem.code, 'restore').expect(204);
    expect(refresh.mock.calls).toEqual([[[ids.stranger]], [[ids.stranger]]]);
    refresh.mockRestore();
  });

  it('refuses to restore a purged problem', async () => {
    const problem = await owned();
    await remove('owner', problem.code).expect(204);
    await tombstone(api, problem._id);
    await post('owner', problem.code, 'restore')
      .expect(409)
      .expect(errorCode('purged'));
  });

  it('lets only a superuser queue an immediate purge, of a deleted problem, with the code typed', async () => {
    const problem = await owned();
    await post('owner', problem.code, 'purge-now', {
      confirmCode: problem.code,
    }).expect(403);
    await post('root', problem.code, 'purge-now', { confirmCode: problem.code })
      .expect(409)
      .expect(errorCode('not_deleted'));
    await remove('owner', problem.code).expect(204);
    await post('root', problem.code, 'purge-now', {
      confirmCode: 'nope',
    }).expect(400);
    await post('root', problem.code, 'purge-now', {
      confirmCode: problem.code,
    }).expect(202);
    expect((await purges.getJobs(['waiting'])).map((job) => job.id)).toEqual([
      problemPurgeJobId(problem._id),
    ]);
    await post('root', problem.code, 'purge-now', {
      confirmCode: problem.code,
    }).expect(202);
    expect(await purges.getJobs(['waiting'])).toHaveLength(1);
    const purged = await owned();
    await remove('owner', purged.code).expect(204);
    await tombstone(api, purged._id);
    await post('root', purged.code, 'purge-now', { confirmCode: purged.code })
      .expect(409)
      .expect(errorCode('purged'));
  });

  it('carries the refusal code in error.issues[] on every refusal', async () => {
    const issueCodes = async (
      request: Promise<{ body: unknown }> | PromiseLike<{ body: unknown }>,
    ) =>
      (
        (await request).body as { error: { issues: { code: string }[] } }
      ).error.issues.map((issue) => issue.code);
    const problem = await owned();
    expect(await issueCodes(remove('owner', problem.code, 'nope'))).toEqual([
      'invalid',
    ]);
    expect(await issueCodes(post('owner', problem.code, 'restore'))).toEqual([
      'not_deleted',
    ]);
    const open = await owned({ isPublic: true });
    expect(await issueCodes(remove('stranger', open.code))).toEqual([
      'forbidden',
    ]);
    expect(await issueCodes(remove('stranger', problem.code))).toEqual([
      'not_found',
    ]);
    await createContest(api, { problems: [contestProblem(problem._id, 0)] });
    expect(await issueCodes(remove('owner', problem.code))).toEqual([
      'problem_in_contest',
    ]);
    expect(
      await issueCodes(
        post('owner', problem.code, 'purge-now', {
          confirmCode: problem.code,
        }),
      ),
    ).toEqual(['forbidden']);
    const gone = await owned();
    await remove('owner', gone.code).expect(204);
    await tombstone(api, gone._id);
    expect(await issueCodes(post('owner', gone.code, 'restore'))).toEqual([
      'purged',
    ]);
  });

  it('allows ten deletes an hour per user', async () => {
    for (let count = 0; count < 10; count += 1) {
      const problem = await owned();
      await remove('owner', problem.code).expect(204);
    }
    const eleventh = await owned();
    await remove('owner', eleventh.code)
      .expect(429)
      .expect(errorCode('rate_limited'));
  });
});
