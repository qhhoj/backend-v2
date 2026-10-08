import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
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
} from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { BULK_REJUDGE_LIMIT } from '../src/modules/submissions/core/rate-limits';

const REJUDGE_PATH = '/api/internal/submissions/rejudge';

interface BulkRejudgeBody {
  count: number;
  dryRun: boolean;
  allowed: boolean;
}

describe('bulk rejudge dry run', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let graded: Queue<SubmissionGradedJob>;
  let manager: TestSession;
  let owner: string;
  let problemId: string;
  const bulk = (session: TestSession, body: object) =>
    authed(api.http().post(REJUDGE_PATH), session).send({
      problem: 'dry',
      ...body,
    });
  const seedFinished = async (count: number) =>
    api.submissions.insertMany(
      Array.from({ length: count }, () => ({
        user: owner,
        problem: problemId,
        language: catalog.languages.cpp,
        status: 'D',
        result: 'AC',
      })),
    );
  const statusesOf = async () =>
    (await api.submissions.find({}, { status: 1 }).lean()).map(
      (row) => row.status,
    );

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    graded = api.app.get(getQueueToken(SUBMISSION_GRADED_QUEUE));
    owner = (await createUserWith(api, 'owner', {}))._id;
    const managerId = (
      await createUserWith(api, 'manager', {
        permissions: ['judge.edit_own_problem', 'judge.rejudge_submission'],
      })
    )._id;
    manager = await loginAs(api, managerId);
    problemId = (
      await createProblem(api, catalog, {
        code: 'dry',
        authors: [managerId],
      })
    )._id;
  });
  beforeEach(async () => {
    await api.submissions.deleteMany({});
    await clearBridgeCommands(api);
    await graded.obliterate({ force: true });
  });
  afterAll(() => api.teardown());

  it('counts a dry run without resetting, commanding or publishing anything', async () => {
    await seedFinished(2);
    const body = dataOf<BulkRejudgeBody>(
      await bulk(manager, { dryRun: true }).expect(200),
    );
    expect(body).toEqual({ count: 2, dryRun: true, allowed: true });
    expect(await statusesOf()).toEqual(['D', 'D']);
    expect(await bridgeCommands(api)).toEqual([]);
    expect(await graded.getJobs(['waiting'])).toEqual([]);
  });

  it('answers allowed: false on a dry run above the limit, and refuses the real run with 403', async () => {
    await seedFinished(BULK_REJUDGE_LIMIT + 1);
    const preview = dataOf<BulkRejudgeBody>(
      await bulk(manager, { dryRun: true }).expect(200),
    );
    expect(preview).toEqual({
      count: BULK_REJUDGE_LIMIT + 1,
      dryRun: true,
      allowed: false,
    });
    await bulk(manager, {}).expect(403).expect(errorCode('forbidden'));
    expect(await statusesOf()).not.toContain('QU');
    expect(await bridgeCommands(api)).toEqual([]);
  });

  it('runs the real rejudge and reports what it reset', async () => {
    await seedFinished(2);
    const body = dataOf<BulkRejudgeBody>(await bulk(manager, {}).expect(200));
    expect(body).toEqual({ count: 2, dryRun: false, allowed: true });
    expect(await statusesOf()).toEqual(['QU', 'QU']);
    expect(await bridgeCommands(api)).toHaveLength(1);
  });
});
