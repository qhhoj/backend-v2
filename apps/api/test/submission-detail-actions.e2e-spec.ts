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
  clearBridgeCommands,
  dataOf,
  seedSubmission,
} from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const SUBMISSIONS = '/api/internal/submissions';

interface DetailBody {
  lockedAfter: string | null;
  viewer: { canAbort: boolean; canRejudge: boolean; canReject: boolean };
}

const NO_ACTIONS = { canAbort: false, canRejudge: false, canReject: false };

describe('submission detail action flags', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    graded = api.app.get(getQueueToken(SUBMISSION_GRADED_QUEUE));
    const roles: Array<[string, object]> = [
      ['owner', {}],
      ['outsider', {}],
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
  afterAll(() => api.teardown());

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
    });
    expect(body.lockedAfter).toBeNull();
    await post('manager', `${SUBMISSIONS}/${id}/rejudge`).expect(204);
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
    });
    await post('manager', `${SUBMISSIONS}/${id}/rejudge`)
      .expect(409)
      .expect(errorCode('conflict'));
  });
});
