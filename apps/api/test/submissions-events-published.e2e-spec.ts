import type { Submission } from '@libs/database';
import { recordSubmissionEvents } from '@libs/judging/testing';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { setupApiTest, TEST_ENV } from './setup';
import type { ApiTest } from './setup';

const SUBMISSIONS = '/api/internal/submissions';

describe('submission events published by the api', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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
      () => eventsOf(rejudged).length === 1 && eventsOf(rejected).length === 1,
    );
    expect(eventsOf(rejudged)).toEqual([['queued', 'QU']]);
    expect(eventsOf(rejected)).toEqual([['done', 'D']]);
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
