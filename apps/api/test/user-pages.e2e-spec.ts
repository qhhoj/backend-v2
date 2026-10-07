import { AppError } from '@libs/common';
import { newId } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type {
  ActivityResponse,
  PpEntryResponse,
  RatingHistoryEntryResponse,
  SolvedResponse,
  UserPageResponse,
} from '../src/modules/users/pages/dto/user-page.response';
import { UserPagesRepository } from '../src/modules/users/pages/user-pages.repository';
import { createContest, hoursFromNow } from './contest-fixtures';
import { createOrganization } from './organization-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const DAY = 86_400_000;
const daysAgo = (days: number, hourUtc: number) => {
  const at = new Date(Date.now() - days * DAY);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at;
};
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

describe('user pages', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const get = (url: string, session?: TestSession) =>
    session ? authed(api.http().get(url), session) : api.http().get(url);
  const submit = (
    user: string,
    problem: string,
    fields: Record<string, unknown>,
  ) =>
    api.submissions.create({
      user,
      problem,
      language: catalog.languages.cpp,
      status: 'D',
      result: 'AC',
      casePoints: 1,
      caseTotal: 1,
      ...fields,
    });

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterAll(() => api.teardown());

  it('shows the profile with ranks among listed, active users', async () => {
    const subject = await createUserWith(api, 'subject', {
      performancePoints: 50,
      rating: 1500,
      aboutHtml: '<p>hi</p>',
      usernameDisplayOverride: 'Subject S',
    });
    await createUserWith(api, 'above', { performancePoints: 80, rating: 1600 });
    await createUserWith(api, 'tied', { performancePoints: 50, rating: 1500 });
    await createUserWith(api, 'hidden', {
      performancePoints: 90,
      rating: 2000,
      isUnlisted: true,
    });
    await createUserWith(api, 'inactive', {
      performancePoints: 95,
      rating: 2100,
      isActive: false,
    });
    const page = dataOf<UserPageResponse>(
      await get('/api/internal/users/SUBJECT').expect(200),
    );
    expect(page).toMatchObject({
      id: subject._id,
      username: 'subject',
      displayName: 'Subject S',
      aboutHtml: '<p>hi</p>',
      rank: 2,
      ratingRank: 2,
    });
    await createUserWith(api, 'unrated', {});
    expect(
      dataOf<UserPageResponse>(
        await get('/api/internal/users/unrated').expect(200),
      ).ratingRank,
    ).toBeNull();
    await get('/api/internal/users/nobody').expect(404);
  });

  it('lists only the organizations the viewer may see, in the user order', async () => {
    const owner = await createUserWith(api, 'org_owner', {});
    const listed = await createOrganization(api, { slug: 'pub' }, [owner._id]);
    const unlisted = await createOrganization(
      api,
      { slug: 'secret', isUnlisted: true },
      [owner._id],
    );
    const outsider = await loginAs(
      api,
      (await createUserWith(api, 'org_outsider', {}))._id,
    );
    const member = await loginAs(
      api,
      (
        await createUserWith(api, 'org_member', {
          organizations: [unlisted._id],
        })
      )._id,
    );
    const staff = await loginAs(
      api,
      (
        await createUserWith(api, 'org_staff', {
          permissions: ['judge.edit_all_organization'],
        })
      )._id,
    );
    const slugs = async (session?: TestSession) =>
      dataOf<UserPageResponse>(
        await get('/api/internal/users/org_owner', session).expect(200),
      ).organizations.map((row) => row.slug);
    expect(await slugs()).toEqual([listed.slug]);
    expect(await slugs(outsider)).toEqual([listed.slug]);
    expect(await slugs(member)).toEqual([listed.slug, unlisted.slug]);
    expect(await slugs(staff)).toEqual([listed.slug, unlisted.slug]);
  });

  it('returns the rating history oldest first with min, max and count on the page', async () => {
    const rated = await createUserWith(api, 'rated', { rating: 1700 });
    const early = await createContest(api, {
      name: 'Early',
      startTime: hoursFromNow(-50),
      endTime: hoursFromNow(-48),
    });
    const late = await createContest(api, {
      name: 'Late',
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-3),
    });
    for (const [contest, rating, rank] of [
      [late, 1700, 2],
      [early, 1400, 7],
    ] as const)
      await api.ratings.create({
        user: rated._id,
        contest: contest._id,
        participation: newId(),
        contestEndTime: contest.endTime,
        rank,
        rating,
        mean: rating,
        performance: rating,
        lastRated: new Date(),
      });
    const history = dataOf<RatingHistoryEntryResponse[]>(
      await get('/api/internal/users/rated/ratings').expect(200),
    );
    expect(
      history.map((row) => [row.contestName, row.rating, row.rank]),
    ).toEqual([
      ['Early', 1400, 7],
      ['Late', 1700, 2],
    ]);
    expect(
      dataOf<UserPageResponse>(
        await get('/api/internal/users/rated').expect(200),
      ).ratingSummary,
    ).toEqual({ min: 1400, max: 1700, contests: 2 });
  });

  it('keeps the points of rated contests the viewer cannot see but not their names', async () => {
    const rated = await createUserWith(api, 'rated_secret', { rating: 1500 });
    const secret = await createContest(api, {
      name: 'Secret',
      isPrivate: true,
      startTime: hoursFromNow(-30),
      endTime: hoursFromNow(-28),
    });
    await api.ratings.create({
      user: rated._id,
      contest: secret._id,
      participation: newId(),
      contestEndTime: secret.endTime,
      rank: 1,
      rating: 1500,
      mean: 1500,
      performance: 1500,
      lastRated: new Date(),
    });
    const entryFor = async (session?: TestSession) =>
      dataOf<RatingHistoryEntryResponse[]>(
        await get('/api/internal/users/rated_secret/ratings', session).expect(
          200,
        ),
      )[0];
    expect(await entryFor()).toMatchObject({
      contestKey: null,
      contestName: null,
      rating: 1500,
      rank: 1,
    });
    const invited = await createUserWith(api, 'secret_guest', {});
    await api.contests.updateOne(
      { _id: secret._id },
      { privateContestants: [invited._id] },
    );
    expect(await entryFor(await loginAs(api, invited._id))).toMatchObject({
      contestName: 'Secret',
    });
    expect(
      await entryFor(
        await loginAs(
          api,
          (await createUserWith(api, 'secret_stranger', {}))._id,
        ),
      ),
    ).toMatchObject({ contestName: null });
  });

  it('nulls rank, performance and rating of hidden and re-frozen boards for viewers who may not read them', async () => {
    const rated = await createUserWith(api, 'rated_boards', { rating: 1600 });
    const author = await createUserWith(api, 'board_author', {
      permissions: ['judge.edit_own_contest'],
    });
    const rate = (contest: { _id: string; endTime: Date }, rating: number) =>
      api.ratings.create({
        user: rated._id,
        contest: contest._id,
        participation: newId(),
        contestEndTime: contest.endTime,
        rank: 4,
        rating,
        mean: rating,
        performance: rating + 100,
        lastRated: new Date(),
      });
    const open = await createContest(api, {
      name: 'Open board',
      startTime: hoursFromNow(-60),
      endTime: hoursFromNow(-58),
    });
    const hidden = await createContest(api, {
      name: 'Hidden board',
      scoreboardVisibility: 'H',
      authors: [author._id],
      startTime: hoursFromNow(-40),
      endTime: hoursFromNow(-38),
    });
    const refrozen = await createContest(api, {
      name: 'Refrozen board',
      formatName: 'icpc',
      authors: [author._id],
      startTime: hoursFromNow(-20),
      endTime: hoursFromNow(-1),
      frozenLastMinutes: 600,
    });
    await rate(open, 1200);
    await rate(hidden, 1900);
    await rate(refrozen, 2100);
    const results = async (session?: TestSession) =>
      dataOf<RatingHistoryEntryResponse[]>(
        await get('/api/internal/users/rated_boards/ratings', session).expect(
          200,
        ),
      ).map((row) => [row.contestName, row.rating, row.rank, row.performance]);
    const summary = async (session?: TestSession) =>
      dataOf<UserPageResponse>(
        await get('/api/internal/users/rated_boards', session).expect(200),
      ).ratingSummary;

    expect(await results()).toEqual([
      ['Open board', 1200, 4, 1300],
      ['Hidden board', null, null, null],
      ['Refrozen board', null, null, null],
    ]);
    expect(await summary()).toEqual({ min: 1200, max: 1200, contests: 1 });
    const authorSession = await loginAs(api, author._id);
    expect(await results(authorSession)).toEqual([
      ['Open board', 1200, 4, 1300],
      ['Hidden board', 1900, 4, 2000],
      ['Refrozen board', 2100, 4, 2200],
    ]);
    expect(await summary(authorSession)).toEqual({
      min: 1200,
      max: 2100,
      contests: 3,
    });
  });

  it('groups the best points per public problem and breaks the PP down like legacy', async () => {
    const solver = await createUserWith(api, 'solver', {});
    const first = await createProblem(api, catalog, {
      code: 'pp_a',
      points: 1000,
      groupId: catalog.groups.voi,
    });
    const second = await createProblem(api, catalog, {
      code: 'pp_b',
      points: 800,
    });
    const hidden = await createProblem(api, catalog, {
      code: 'pp_hidden',
      isPublic: false,
    });
    const orgPrivate = await createProblem(api, catalog, {
      code: 'pp_org',
      isOrganizationPrivate: true,
    });
    await submit(solver._id, first._id, {
      points: 400,
      result: 'WA',
      date: daysAgo(3, 1),
    });
    const best = await submit(solver._id, first._id, {
      points: 1000,
      date: daysAgo(2, 1),
    });
    await submit(solver._id, second._id, { points: 800, date: daysAgo(1, 1) });
    await submit(solver._id, hidden._id, { points: 999 });
    await submit(solver._id, orgPrivate._id, { points: 999 });
    const solved = dataOf<SolvedResponse>(
      await get('/api/internal/users/solver/solved').expect(200),
    );
    expect(solved.groups).toEqual([
      {
        name: 'Uncategorized',
        points: 800,
        problems: [{ code: 'pp_b', name: 'PP_B', points: 800, total: 800 }],
      },
      {
        name: 'VOI',
        points: 1000,
        problems: [{ code: 'pp_a', name: 'PP_A', points: 1000, total: 1000 }],
      },
    ]);
    const response = await get(
      '/api/internal/users/solver/pp-breakdown?pageSize=1',
    ).expect(200);
    const [top] = dataOf<PpEntryResponse[]>(response);
    expect(top).toMatchObject({
      rank: 1,
      weight: 100,
      points: 1000,
      scaledPoints: 1000,
      problem: { code: 'pp_a' },
      submission: { id: best._id, language: 'CPP17' },
    });
    expect((response.body as { meta: { hasMore: boolean } }).meta.hasMore).toBe(
      true,
    );
    const [second_] = dataOf<PpEntryResponse[]>(
      await get(
        '/api/internal/users/solver/pp-breakdown?pageSize=1&page=2',
      ).expect(200),
    );
    expect(second_.weight).toBeCloseTo(98.514, 9);
    expect(second_.scaledPoints).toBeCloseTo(800 * 0.98514, 9);
    expect(top.problem).toEqual({ code: 'pp_a', name: 'PP_A' });
    const secondPage = await profileQueries(api.db, () =>
      get('/api/internal/users/solver/pp-breakdown?pageSize=1&page=2').expect(
        200,
      ),
    );
    expect(
      secondPage.filter(({ collection }) => collection === 'submissions'),
    ).toEqual([]);
  });

  it('buckets submissions by day in negative and positive time zones', async () => {
    const active = await createUserWith(api, 'active', {});
    const problem = await createProblem(api, catalog, { code: 'heat' });
    const early = daysAgo(10, 3);
    const late = daysAgo(20, 20);
    for (const date of [early, late, daysAgo(400, 12)])
      await submit(active._id, problem._id, { date });
    const daysIn = async (timezone: string) =>
      dataOf<ActivityResponse>(
        await get(
          `/api/internal/users/active/activity?timezone=${encodeURIComponent(timezone)}`,
        ).expect(200),
      ).days;
    expect(await daysIn('America/Toronto')).toEqual({
      [utcDay(new Date(early.getTime() - DAY))]: 1,
      [utcDay(late)]: 1,
    });
    expect(await daysIn('Asia/Ho_Chi_Minh')).toEqual({
      [utcDay(early)]: 1,
      [utcDay(new Date(late.getTime() + DAY))]: 1,
    });
    expect(
      dataOf<ActivityResponse>(
        await get('/api/internal/users/active/activity').expect(200),
      ),
    ).toMatchObject({
      timezone: 'UTC',
      days: { [utcDay(early)]: 1, [utcDay(late)]: 1 },
    });
    const viewer = await loginAs(
      api,
      (await createUserWith(api, 'zoned', { timezone: 'Asia/Ho_Chi_Minh' }))
        ._id,
    );
    expect(
      dataOf<ActivityResponse>(
        await get('/api/internal/users/active/activity', viewer).expect(200),
      ).timezone,
    ).toBe('Asia/Ho_Chi_Minh');
    await get(
      '/api/internal/users/active/activity?timezone=Mars%2FBase',
    ).expect(400);
    expect(await daysIn('america/toronto')).toEqual(
      await daysIn('America/Toronto'),
    );
  });

  it('caches the heatmap per user and zone for ten minutes and reads it through the user-date index', async () => {
    const busy = await createUserWith(api, 'busy', {});
    const problem = await createProblem(api, catalog, { code: 'cached' });
    await submit(busy._id, problem._id, { date: daysAgo(1, 12) });
    const operations = await profileQueries(api.db, () =>
      get('/api/internal/users/busy/activity?timezone=UTC').expect(200),
    );
    const reads = operations.filter(
      ({ collection }) => collection === 'submissions',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => planSummary.includes('IXSCAN')),
    ).toBe(true);
    await submit(busy._id, problem._id, { date: daysAgo(1, 13) });
    expect(
      Object.values(
        dataOf<ActivityResponse>(
          await get('/api/internal/users/busy/activity?timezone=UTC').expect(
            200,
          ),
        ).days,
      ),
    ).toEqual([1]);
    expect(
      Object.values(
        dataOf<ActivityResponse>(
          await get(
            '/api/internal/users/busy/activity?timezone=Asia%2FTokyo',
          ).expect(200),
        ).days,
      ),
    ).toEqual([2]);
  });

  it('rejects a zone Mongo does not know with a 400 on timezone', async () => {
    const repository = api.app.get(UserPagesRepository);
    await expect(
      repository.activity(newId(), new Date(0), 'Mars/Base'),
    ).rejects.toMatchObject({
      status: 400,
      fields: { timezone: [expect.any(String)] },
    });
  });

  it("falls back to UTC when the viewer's stored zone is rejected by Mongo, but not for an asked one", async () => {
    const stored = await createUserWith(api, 'zone_stored', {
      timezone: 'Asia/Tokyo',
    });
    const viewer = await loginAs(api, stored._id);
    const rejection = () =>
      new AppError('validation_failed', 400, 'Unknown time zone', {
        timezone: ['x'],
      });
    const spy = jest
      .spyOn(UserPagesRepository.prototype, 'activity')
      .mockRejectedValueOnce(rejection());
    try {
      expect(
        dataOf<ActivityResponse>(
          await get('/api/internal/users/active/activity', viewer).expect(200),
        ).timezone,
      ).toBe('UTC');
      spy.mockRejectedValueOnce(rejection());
      await get(
        '/api/internal/users/active/activity?timezone=Asia%2FSeoul',
        viewer,
      ).expect(400);
    } finally {
      spy.mockRestore();
    }
  });
});
