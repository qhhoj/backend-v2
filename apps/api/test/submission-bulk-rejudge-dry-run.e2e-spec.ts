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
  let sessions: Record<string, TestSession>;
  let owner: string;
  let problemId: string;
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
    api = await setupApiTest();
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
    ];
    sessions = {};
    const ids: Record<string, string> = {};
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
  afterAll(() => api.teardown());

  it('counts a dry run without resetting, commanding or publishing anything', async () => {
    await insertRows(2);
    const body = dataOf<BulkRejudgeBody>(
      await bulk('manager', { dryRun: true }).expect(200),
    );
    expect(body).toEqual({ count: 2, dryRun: true, allowed: true });
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
    const real = dataOf<BulkRejudgeBody>(await bulk('manager', {}).expect(200));
    expect(real.count).toBe(preview.count);
  });

  it('answers allowed: false on a dry run above the limit, and refuses the real run with 403', async () => {
    await insertRows(BULK_REJUDGE_LIMIT + 1);
    const preview = dataOf<BulkRejudgeBody>(
      await bulk('manager', { dryRun: true }).expect(200),
    );
    expect(preview).toEqual({
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
      dataOf<BulkRejudgeBody>(await bulk('lot', { dryRun: true }).expect(200)),
    ).toEqual({
      count: BULK_REJUDGE_LIMIT + 1,
      dryRun: true,
      allowed: true,
    });
    expect(await statusesOf()).not.toContain('QU');
  });

  it('runs the real rejudge and reports what it reset', async () => {
    await insertRows(2);
    const body = dataOf<BulkRejudgeBody>(await bulk('manager', {}).expect(200));
    expect(body).toEqual({ count: 2, dryRun: false, allowed: true });
    expect(await statusesOf()).toEqual(['QU', 'QU']);
    expect(await bridgeCommands(api)).toHaveLength(1);
  });
});
