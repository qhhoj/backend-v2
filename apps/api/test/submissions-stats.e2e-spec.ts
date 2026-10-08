import { randomUUID } from 'node:crypto';
import { REDIS, startOfDayIn } from '@libs/common';
import { profileQueries } from '@libs/database/testing';
import type Redis from 'ioredis';
import { createProblem, createUserWith, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { createContest, hoursFromNow } from './contest-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const STATS = '/api/internal/submissions/stats';
interface Stats {
  judgedToday: number;
  acceptedToday: number;
  queueLength: number;
  judgesOnline: number;
  judgesTotal: number;
}

describe('GET /submissions/stats', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let publicProblem: string;
  let privateProblem: string;
  let user: string;
  let today: Date;
  const stats = async () =>
    dataOf<Stats>(await api.http().get(STATS).expect(200));
  const clearCache = () => api.app.get<Redis>(REDIS).del('submissions:stats');
  const row = (problem: string, fields: object) =>
    api.submissions.create({
      user,
      problem,
      language: catalog.languages.python,
      points: 0,
      casePoints: 0,
      caseTotal: 1,
      ...fields,
    });

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    publicProblem = (
      await createProblem(api, catalog, { code: 'open', isPublic: true })
    )._id;
    privateProblem = (
      await createProblem(api, catalog, { code: 'secret', isPublic: false })
    )._id;
    user = (await createUserWith(api, 'solver'))._id;
    await api.setSetting('site.timeZone', 'Asia/Ho_Chi_Minh');
    today = new Date(Date.now() - 1000);
    const yesterday = new Date(
      startOfDayIn('Asia/Ho_Chi_Minh', new Date()).getTime() - 3_600_000,
    );
    await row(publicProblem, {
      status: 'D',
      result: 'AC',
      judgedDate: today,
      casePoints: 1,
    });
    await row(publicProblem, { status: 'D', result: 'WA', judgedDate: today });
    await row(publicProblem, {
      status: 'D',
      result: 'AC',
      judgedDate: yesterday,
      casePoints: 1,
    });
    await row(privateProblem, {
      status: 'D',
      result: 'AC',
      judgedDate: today,
      casePoints: 1,
    });
    // Leak classes that must not move any count: an organization-private problem, a contest whose
    // list is hidden while it runs, and a frozen contest during its freeze.
    const orgPrivateProblem = (
      await createProblem(api, catalog, {
        code: 'orgonly',
        isPublic: true,
        isOrganizationPrivate: true,
        organizations: [randomUUID()],
      })
    )._id;
    const hiddenContest = (
      await createContest(api, { showSubmissionList: false })
    )._id;
    const frozenContest = (
      await createContest(api, {
        showSubmissionList: true,
        formatName: 'icpc',
        frozenLastMinutes: 30,
        endTime: hoursFromNow(0.1),
      })
    )._id;
    for (const hidingProblem of [
      { problem: orgPrivateProblem },
      { problem: publicProblem, contest: hiddenContest },
      { problem: publicProblem, contest: frozenContest },
    ]) {
      const { problem, ...where } = hidingProblem;
      await row(problem, {
        status: 'D',
        result: 'AC',
        judgedDate: today,
        casePoints: 1,
        ...where,
      });
      await row(problem, { status: 'QU', ...where });
    }
    await row(publicProblem, { status: 'QU' });
    await row(publicProblem, { status: 'P' });
    await row(publicProblem, { status: 'G' });
    await row(privateProblem, { status: 'QU' });
    for (let index = 0; index < 100; index++)
      await row(publicProblem, {
        status: 'D',
        result: 'AC',
        judgedDate: yesterday,
        casePoints: 1,
      });
    await api.judges.create([
      { name: 'j1', authKeyHash: 'a', online: true },
      { name: 'j2', authKeyHash: 'b', online: true },
      { name: 'j3', authKeyHash: 'c', online: false },
      { name: 'j4', authKeyHash: 'd', isDisabled: true },
      { name: 'j5', authKeyHash: 'e', isBlocked: true, online: false },
    ]);
  });
  afterAll(() => api.teardown());
  beforeEach(clearCache);

  it('counts today only, over what a signed-out viewer may see', async () => {
    expect(await stats()).toEqual({
      judgedToday: 2,
      acceptedToday: 1,
      queueLength: 3,
      judgesOnline: 2,
      judgesTotal: 3,
    });
  });

  it('answers from the cache for 30 seconds', async () => {
    await stats();
    await row(publicProblem, {
      status: 'D',
      result: 'AC',
      judgedDate: new Date(),
      casePoints: 1,
    });
    expect((await stats()).judgedToday).toBe(2);
    await clearCache();
    expect((await stats()).judgedToday).toBe(3);
  });

  it('starts the day at midnight of the site time zone', async () => {
    const zone = 'Pacific/Kiritimati';
    await api.setSetting('site.timeZone', zone);
    await clearCache();
    const start = startOfDayIn(zone, new Date());
    const before = await stats();
    await row(publicProblem, {
      status: 'D',
      result: 'AC',
      judgedDate: new Date(start.getTime() - 1),
    });
    await clearCache();
    expect((await stats()).judgedToday).toBe(before.judgedToday);
    await row(publicProblem, {
      status: 'D',
      result: 'AC',
      judgedDate: start,
      casePoints: 1,
    });
    await clearCache();
    expect((await stats()).judgedToday).toBe(before.judgedToday + 1);
    await api.setSetting('site.timeZone', 'Asia/Ho_Chi_Minh');
  });

  it('reads submissions through an index and never scans the old ones', async () => {
    await clearCache();
    const operations = await profileQueries(api.db, () =>
      api.http().get(STATS).expect(200),
    );
    const onSubmissions = operations.filter(
      (operation) => operation.collection === 'submissions',
    );
    expect(onSubmissions.length).toBeGreaterThanOrEqual(3);
    for (const operation of onSubmissions) {
      expect(operation.planSummary).toContain('IXSCAN');
      expect(operation.planSummary).not.toContain('COLLSCAN');
      // 100 submissions judged yesterday must not be looked at: only today's and the queue's rows count
      expect(operation.docsExamined).toBeLessThanOrEqual(12);
    }
  });
});
