import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';

describe('rescore on problem edits', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let admin: TestSession;
  let queue: Queue<ProblemRescoreJob>;
  let codes = 0;
  const problem = () => {
    codes += 1;
    return createProblem(api, catalog, { code: `rescore${codes}` });
  };
  const queuedProblemIds = async () =>
    (await queue.getJobs(['waiting', 'delayed'])).map(
      (job) => job.data.problemId,
    );

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    admin = await loginAs(
      api,
      (await createUserWith(api, 'admin', { isSuperuser: true }))._id,
    );
    queue = api.app.get<Queue<ProblemRescoreJob>>(
      getQueueToken(PROBLEM_RESCORE_QUEUE),
    );
  });
  afterAll(() => api.teardown());
  beforeEach(() => queue.obliterate({ force: true }));

  it.each([
    [{ points: 1200 }],
    [{ partial: true }],
    [{ isPublic: false }],
    [{ isOrganizationPrivate: true }],
  ])('queues one rescore when %j changes', async (change) => {
    const edited = await problem();
    await authed(api.http().patch(`${PROBLEMS}/${edited.code}`), admin)
      .send(change)
      .expect(200);
    expect(await queuedProblemIds()).toEqual([edited._id]);
  });

  it('queues nothing for other fields or an unchanged value', async () => {
    const edited = await problem();
    await authed(api.http().patch(`${PROBLEMS}/${edited.code}`), admin)
      .send({ name: 'Renamed', points: 1000, partial: false })
      .expect(200);
    expect(await queuedProblemIds()).toEqual([]);
  });
});
