import { REDIS } from '@libs/common';
import type Redis from 'ioredis';
import { newId } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type {
  ActivityResponse,
  PpEntryResponse,
  RatingHistoryEntryResponse,
  SolvedResponse,
  UserPageResponse,
} from '../src/modules/users/pages/dto/user-page.response';
import {
  createContest,
  hoursFromNow,
  contestProblem,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
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
import { setupApiTest, errorCode } from './setup';
import type { ApiTest } from './setup';
import type { RecentCommentResponse } from '../src/modules/comments/core/dto/recent-comment.response';
import type { HomeResponse } from '../src/modules/home/dto/home.response';
import {
  createComment,
  createPost,
  signedInWriter,
  commentPageUrl,
  commentUrl,
} from './community-fixtures';
import {
  COMMENT_THREAD_REPLY_LIMIT,
  COMMENT_THREADS_PAGE_SIZE,
} from '@libs/community';
import type { CommentPageType } from '@libs/community';
import type { CommentPageResponse } from '../src/modules/comments/core/dto/comment.response';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from user-pages.e2e-spec.ts
{
  const DAY = 86_400_000;
  const daysAgo = (days: number, hourUtc: number) => {
    const at = new Date(Date.now() - days * DAY);
    at.setUTCHours(hourUtc, 0, 0, 0);
    return at;
  };
  const utcDay = (date: Date) => date.toISOString().slice(0, 10);

  describe('user pages', () => {
    beforeAll(() => api.reset());
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
      catalog = await seedCatalog(api);
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
        ).map((row) => [
          row.contestName,
          row.rating,
          row.rank,
          row.performance,
        ]);
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
      await submit(solver._id, second._id, {
        points: 800,
        date: daysAgo(1, 1),
      });
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
      expect(
        (response.body as { meta: { hasMore: boolean } }).meta.hasMore,
      ).toBe(true);
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

    it("leaves a running contest's solves out of solved and pp-breakdown until the contest ends", async () => {
      const racer = await createUserWith(api, 'racer', {});
      const viewer = await loginAs(
        api,
        (await createUserWith(api, 'race_viewer', {}))._id,
      );
      const inContest = await createProblem(api, catalog, {
        code: 'race_c',
        points: 1000,
      });
      const practice = await createProblem(api, catalog, {
        code: 'race_p',
        points: 900,
      });
      const contest = await createContest(api, { showSubmissionList: false });
      await submit(racer._id, inContest._id, {
        points: 1000,
        contest: contest._id,
      });
      await submit(racer._id, practice._id, { points: 900 });
      const shown = async (session?: TestSession) => {
        const solved = dataOf<SolvedResponse>(
          await get('/api/internal/users/racer/solved', session).expect(200),
        );
        const pp = dataOf<PpEntryResponse[]>(
          await get('/api/internal/users/racer/pp-breakdown', session).expect(
            200,
          ),
        );
        return {
          solved: solved.groups
            .flatMap((group) => group.problems.map((problem) => problem.code))
            .sort(),
          pp: pp.map((entry) => entry.problem.code).sort(),
        };
      };
      for (const session of [undefined, viewer])
        expect(await shown(session)).toEqual({
          solved: ['race_p'],
          pp: ['race_p'],
        });
      await api.contests.updateOne(
        { _id: contest._id },
        { startTime: hoursFromNow(-5), endTime: hoursFromNow(-1) },
      );
      // The breakdown is cached per user for ten minutes.
      await api.app.get<Redis>(REDIS).del(`user-pp:${racer._id}`);
      for (const session of [undefined, viewer])
        expect(await shown(session)).toEqual({
          solved: ['race_c', 'race_p'],
          pp: ['race_c', 'race_p'],
        });
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

    it('counts the submissions the viewer may see, as the submission list totals them', async () => {
      const counted = await createUserWith(api, 'counted', {});
      const open = await createProblem(api, catalog, { code: 'count_open' });
      const closed = await createProblem(api, catalog, {
        code: 'count_closed',
        isPublic: false,
      });
      await submit(counted._id, open._id, { points: 1 });
      await submit(counted._id, open._id, { points: 0, result: 'WA' });
      await submit(counted._id, closed._id, { points: 1 });
      const staff = await loginAs(
        api,
        (
          await createUserWith(api, 'count_staff', {
            permissions: ['judge.see_private_problem'],
          })
        )._id,
      );
      const countFor = async (session?: TestSession) =>
        dataOf<UserPageResponse>(
          await get('/api/internal/users/counted', session).expect(200),
        ).submissionCount;
      const listTotal = async (session?: TestSession) =>
        (
          (
            await get('/api/internal/submissions?user=counted', session).expect(
              200,
            )
          ).body as { meta: { total: number } }
        ).meta.total;
      expect(await countFor()).toBe(2);
      expect(await countFor()).toBe(await listTotal());
      expect(await countFor(staff)).toBe(3);
      expect(await countFor(staff)).toBe(await listTotal(staff));
    });

    it('shows the ban reason and superuser flag only to judges who may ban', async () => {
      await createUserWith(api, 'banned_page', {
        banReason: 'spam',
        displayRank: 'banned',
        isActive: false,
      });
      await createUserWith(api, 'root_page', { isSuperuser: true });
      await createUserWith(api, 'fresh_page', { isActive: false });
      const moderator = await loginAs(
        api,
        (
          await createUserWith(api, 'page_moderator', {
            permissions: ['judge.ban_user'],
          })
        )._id,
      );
      const ordinary = await loginAs(
        api,
        (await createUserWith(api, 'page_ordinary', {}))._id,
      );
      const staffOf = async (username: string, session?: TestSession) =>
        dataOf<UserPageResponse>(
          await get(`/api/internal/users/${username}`, session).expect(200),
        ).staff;
      expect(await staffOf('banned_page', moderator)).toEqual({
        isSuperuser: false,
        isActive: false,
        banReason: 'spam',
      });
      expect(await staffOf('root_page', moderator)).toEqual({
        isSuperuser: true,
        isActive: true,
        banReason: null,
      });
      expect(await staffOf('fresh_page', moderator)).toEqual({
        isSuperuser: false,
        isActive: false,
        banReason: null,
      });
      const superuser = await loginAs(
        api,
        (await createUserWith(api, 'page_superuser', { isSuperuser: true }))
          ._id,
      );
      expect(await staffOf('banned_page', superuser)).toEqual({
        isSuperuser: false,
        isActive: false,
        banReason: 'spam',
      });
      expect(await staffOf('banned_page')).toBeNull();
      expect(await staffOf('banned_page', ordinary)).toBeNull();
    });
  });
}

// from home.e2e-spec.ts
{
  describe('homepage and user comments', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let userCount = 0;
    const person = (extra = {}) =>
      signedInWriter(api, `homey${(userCount += 1)}`, extra);
    const home = async (session?: TestSession) => {
      const request = api.http().get('/api/internal/home');
      return dataOf<HomeResponse>(
        await (session ? authed(request, session) : request).expect(200),
      );
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
    });
    beforeEach(async () => {
      await Promise.all([
        api.comments.deleteMany({}),
        api.blogPosts.deleteMany({}),
      ]);
      const redis = api.app.get<Redis>(REDIS);
      const cached = await redis.keys('*feed:*');
      const slices = await redis.keys('home:*');
      if (cached.length + slices.length) await redis.del(...cached, ...slices);
    });

    it('skips comments on pages the viewer cannot read and stays bounded', async () => {
      const { user: author } = await person();
      const post = await createPost(api);
      const hiddenContest = await createContest(api, { isPrivate: true });
      for (let index = 0; index < 3; index += 1)
        await createComment(api, {
          page: { type: 'blog', id: post._id },
          author: author._id,
        });
      for (let index = 0; index < 30; index += 1)
        await createComment(api, {
          page: { type: 'contest', id: hiddenContest._id },
          author: author._id,
        });
      await createComment(api, {
        page: { type: 'blog', id: post._id },
        author: author._id,
        hidden: true,
      });
      const operations = await profileQueries(api.db, () => home());
      const { recentComments } = await home();
      expect(recentComments).toHaveLength(3);
      expect(
        recentComments.every((comment) => comment.page.type === 'blog'),
      ).toBe(true);
      expect(recentComments[0].page).toEqual({
        type: 'blog',
        key: post._id,
        title: post.title,
      });
      const reads = operations.filter(
        ({ collection, operation }) =>
          collection === 'comments' && operation === 'query',
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.length).toBeLessThanOrEqual(10);
      expect(
        reads.every(({ planSummary }) => planSummary.includes('IXSCAN')),
      ).toBe(true);
      expect(
        Math.max(...reads.map(({ docsExamined }) => docsExamined)),
      ).toBeLessThanOrEqual(20);
      await api.setSetting('contest.officialMode', true);
      try {
        expect((await home()).recentComments).toEqual([]);
      } finally {
        await api.setSetting('contest.officialMode', false);
      }
    });

    it("pages a user's readable comments for view_all_user_comment only", async () => {
      const { user: author } = await person();
      const { session: plain } = await person();
      const { session: staff } = await person({
        permissions: ['judge.view_all_user_comment'],
      });
      const post = await createPost(api);
      const privateProblem = await createProblem(api, catalog, {
        code: 'tab_private',
        isPublic: false,
      });
      const written = [];
      for (let index = 0; index < 12; index += 1)
        written.push(
          await createComment(api, {
            page: { type: 'blog', id: post._id },
            author: author._id,
          }),
        );
      await createComment(api, {
        page: { type: 'problem', id: privateProblem._id },
        author: author._id,
      });
      await createComment(api, {
        page: { type: 'blog', id: post._id },
        author: author._id,
        hidden: true,
      });
      const url = `/api/internal/users/${author.username}/comments`;
      await api.http().get(url).expect(401);
      await authed(api.http().get(url), plain)
        .expect(403)
        .expect(errorCode('forbidden'));
      const first = await authed(api.http().get(url), staff).expect(200);
      const firstItems = dataOf<RecentCommentResponse[]>(first);
      const { nextBefore } = (
        first.body as { meta: { nextBefore: string | null } }
      ).meta;
      expect(firstItems.map((comment) => comment.id)).toEqual(
        written
          .slice(2)
          .reverse()
          .map((comment) => comment._id),
      );
      const second = await authed(
        api.http().get(`${url}?before=${nextBefore}`),
        staff,
      ).expect(200);
      expect(
        dataOf<RecentCommentResponse[]>(second).map((comment) => comment.id),
      ).toEqual([written[1]._id, written[0]._id]);
      expect(
        (second.body as { meta: { nextBefore: string | null } }).meta
          .nextBefore,
      ).toBeNull();
      await authed(
        api.http().get('/api/internal/users/nobody_at_all/comments'),
        staff,
      ).expect(404);
      await authed(api.http().get(`${url}?before=nope`), staff).expect(400);
    });
  });
}

// from comment-pages.e2e-spec.ts
{
  describe('comment pages', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let userCount = 0;
    const person = (extra = {}) =>
      signedInWriter(api, `pagereader${(userCount += 1)}`, extra);
    const status = async (
      type: CommentPageType,
      key: string,
      session?: TestSession,
    ) => {
      const request = api.http().get(commentPageUrl(type, key));
      return (await (session ? authed(request, session) : request)).status;
    };
    const read = async (
      type: CommentPageType,
      key: string,
      session?: TestSession,
      query = '',
    ) => {
      const request = api.http().get(commentPageUrl(type, key, query));
      return dataOf<CommentPageResponse>(
        await (session ? authed(request, session) : request).expect(200),
      );
    };
    const past = new Date(Date.now() - 3_600_000);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
    });

    it('mirrors page access for every page type', async () => {
      const { user: member, session: memberSession } = await person();
      const { user: contestant, session: contestantSession } = await person();
      const organization = await createOrganization(api, {}, [member._id]);
      await createProblem(api, catalog, { code: 'pg_pub' });
      await createProblem(api, catalog, { code: 'pg_priv', isPublic: false });
      await createProblem(api, catalog, {
        code: 'pg_org',
        isOrganizationPrivate: true,
        organizations: [organization._id],
      });
      const contestOnly = await createProblem(api, catalog, {
        code: 'pg_conly',
        isPublic: false,
      });
      await createProblem(api, catalog, {
        code: 'pg_ed',
        solution: {
          isPublic: true,
          publishOn: past,
          authors: [],
          content: 'x',
          contentHtml: '<p>x</p>',
        },
      });
      await createProblem(api, catalog, {
        code: 'pg_eddraft',
        solution: {
          isPublic: false,
          publishOn: past,
          authors: [],
          content: 'x',
          contentHtml: '<p>x</p>',
        },
      });
      const contestPublic = await createProblem(api, catalog, {
        code: 'pg_cpub',
      });
      const contest = await createContest(api, {
        key: 'pg_running',
        problems: [
          contestProblem(contestOnly._id, 0),
          contestProblem(contestPublic._id, 1),
        ],
      });
      await createContest(api, { key: 'pg_private', isPrivate: true });
      const participation = await joinParticipation(
        api,
        contest._id,
        contestant._id,
      );
      await makeCurrent(api, contestant._id, participation._id);
      const published = await createPost(api);
      const draft = await createPost(api, { visible: false });
      const organizationPost = await createPost(api, {
        organization: organization._id,
      });
      await api.tagProblems.create({
        code: 'cf_1A',
        name: 'Theatre Square',
        link: 'https://codeforces.com/problemset/problem/1/A',
      });

      const anonymous: Array<[CommentPageType, string, number]> = [
        ['problem', 'pg_pub', 200],
        ['problem', 'pg_priv', 404],
        ['problem', 'pg_org', 404],
        ['problem', 'pg_conly', 404],
        ['problem', 'no_such', 404],
        ['editorial', 'pg_ed', 200],
        ['editorial', 'pg_eddraft', 404],
        ['editorial', 'pg_pub', 404],
        ['contest', 'pg_running', 200],
        ['contest', 'pg_private', 404],
        ['blog', published._id, 200],
        ['blog', draft._id, 404],
        ['blog', organizationPost._id, 404],
        ['blog', 'not-a-uuid', 404],
        ['tagProblem', 'cf_1A', 200],
        ['tagProblem', 'cf_9Z', 404],
      ];
      for (const [type, key, expected] of anonymous)
        expect([type, key, await status(type, key)]).toEqual([
          type,
          key,
          expected,
        ]);
      expect(await status('problem', 'pg_org', memberSession)).toBe(200);
      expect(await status('blog', organizationPost._id, memberSession)).toBe(
        200,
      );
      // Inside a started contest: its problems are readable (and locked), the editorial is not.
      const inContest = await read('problem', 'pg_conly', contestantSession);
      expect(inContest).toMatchObject({
        locked: true,
        canComment: false,
        page: { key: 'pg_conly', title: 'PG_CONLY' },
      });
      expect(await status('editorial', 'pg_ed', contestantSession)).toBe(404);
      expect((await read('problem', 'pg_pub', contestantSession)).locked).toBe(
        false,
      );
      // A contest problem's existing thread is hidden from its contestants only (legacy showed clarifications instead).
      const page = { type: 'problem' as const, id: contestPublic._id };
      const existing = await createComment(api, { page, author: member._id });
      const contestantView = await read(
        'problem',
        'pg_cpub',
        contestantSession,
      );
      expect(contestantView).toMatchObject({
        locked: true,
        comments: [],
        pagination: { total: 0 },
      });
      expect(
        (await read('problem', 'pg_cpub')).comments.map(
          (comment) => comment.id,
        ),
      ).toEqual([existing._id]);
      expect((await api.http().get(commentUrl(existing._id))).status).toBe(200);
      expect(
        (
          await authed(
            api.http().get(commentUrl(existing._id)),
            contestantSession,
          )
        ).status,
      ).toBe(404);
      expect(
        (await api.http().get('/api/internal/comments/pages/ticket/x')).status,
      ).toBe(400);
    });

    it('lists threads newest first with replies in tree order, hiding hidden ones and collapsing low scores', async () => {
      const { user: author, session } = await person();
      const post = await createPost(api);
      const page = { type: 'blog' as const, id: post._id };
      const older = await createComment(api, {
        page,
        author: author._id,
        body: 'older',
      });
      const newer = await createComment(api, {
        page,
        author: author._id,
        body: 'newer',
        score: -5,
      });
      const reply = await createComment(api, {
        page,
        author: author._id,
        parent: older,
        body: 'reply',
      });
      const deep = await createComment(api, {
        page,
        author: author._id,
        parent: reply,
        body: 'deep',
      });
      await createComment(api, {
        page,
        author: author._id,
        parent: older,
        body: 'hidden',
        hidden: true,
      });
      await createComment(api, {
        page,
        author: author._id,
        body: 'hidden root',
        hidden: true,
      });
      await api.commentVotes.create({
        comment: older._id,
        voter: author._id,
        score: 1,
      });
      let view!: CommentPageResponse;
      const operations = await profileQueries(api.db, async () => {
        view = await read('blog', post._id, session);
      });
      const voteReads = operations.filter(
        ({ collection }) => collection === 'commentVotes',
      );
      expect(voteReads.length).toBeGreaterThan(0);
      expect(
        voteReads.every(({ planSummary }) => planSummary.includes('IXSCAN')),
      ).toBe(true);
      expect(
        view.comments.map((comment) => [comment.id, comment.depth]),
      ).toEqual([
        [newer._id, 0],
        [older._id, 0],
        [reply._id, 1],
        [deep._id, 2],
      ]);
      expect(view.comments[0]).toMatchObject({
        collapsed: true,
        score: -5,
        viewerVote: 0,
        canEdit: true,
      });
      expect(view.comments[1]).toMatchObject({
        collapsed: false,
        viewerVote: 1,
        parentId: null,
      });
      expect(view.comments[2]).toMatchObject({
        parentId: older._id,
        author: { id: author._id },
      });
      expect(view.pagination).toEqual({
        page: 1,
        pageSize: COMMENT_THREADS_PAGE_SIZE,
        total: 2,
      });
    });

    it('lists at most COMMENT_THREAD_REPLY_LIMIT replies of a thread, in tree order, and names the cut threads', async () => {
      const { user: author } = await person();
      const post = await createPost(api);
      const page = { type: 'blog' as const, id: post._id };
      const crowded = await createComment(api, { page, author: author._id });
      const first = await createComment(api, {
        page,
        author: author._id,
        parent: crowded,
      });
      const nested = await createComment(api, {
        page,
        author: author._id,
        parent: first,
      });
      for (let index = 2; index <= COMMENT_THREAD_REPLY_LIMIT; index++)
        await createComment(api, {
          page,
          author: author._id,
          parent: crowded,
        });
      const quiet = await createComment(api, { page, author: author._id });
      const answer = await createComment(api, {
        page,
        author: author._id,
        parent: quiet,
      });
      const view = await read('blog', post._id);
      const ids = view.comments.map((comment) => comment.id);
      expect(ids.slice(0, 2)).toEqual([quiet._id, answer._id]);
      const crowdedRows = ids.slice(2);
      expect(crowdedRows).toHaveLength(COMMENT_THREAD_REPLY_LIMIT + 1);
      expect(crowdedRows[0]).toBe(crowded._id);
      expect(crowdedRows.indexOf(nested._id)).toBe(
        crowdedRows.indexOf(first._id) + 1,
      );
      expect(view.truncatedThreads).toEqual([crowded._id]);
    });
  });
}
