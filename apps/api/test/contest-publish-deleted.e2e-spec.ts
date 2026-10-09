import type { PublishProblemsResponse } from '../src/modules/contests/publish/dto/publish-problems.response';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
} from './contest-fixtures';
import { softDelete } from './deleted-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('publishing a contest that lists a deleted problem', () => {
  let api: ApiTest;
  let owner: TestSession;
  let ownerId: string;

  beforeAll(async () => {
    api = await setupApiTest();
    ownerId = (
      await createUserWith(api, 'pubdel_owner', {
        permissions: [
          'judge.edit_own_contest',
          'judge.edit_own_problem',
          'judge.change_public_visibility',
        ],
      })
    )._id;
    owner = await loginAs(api, ownerId);
  });
  afterAll(() => api.teardown());

  it('reports skipped: deleted and publishes nothing for it', async () => {
    const catalog = await seedCatalog(api);
    const problem = await createProblem(api, catalog, {
      code: 'pubdel_gone',
      isPublic: false,
      authors: [ownerId],
      solution: {
        isPublic: false,
        publishOn: new Date(),
        authors: [],
        content: 'e',
        contentHtml: '<p>e</p>',
      },
    });
    await softDelete(api, problem._id);
    const contest = await createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      authors: [ownerId],
      problems: [contestProblem(problem._id, 0)],
    });
    const result = dataOf<PublishProblemsResponse>(
      await authed(
        api.http().post(contestUrl(contest.key, '/publish-problems')),
        owner,
      )
        .send({ editorials: true })
        .expect(200),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        outcome: 'skipped',
        reason: 'deleted',
        editorial: 'skipped',
      }),
    ]);
    const stored = (await api.problems.findById(problem._id).lean())!;
    expect(stored.isPublic).toBe(false);
    expect(stored.solution!.isPublic).toBe(false);
  });
});
