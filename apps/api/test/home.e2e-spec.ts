import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { profileQueries } from '@libs/database/testing';
import type { RecentCommentResponse } from '../src/modules/comments/core/dto/recent-comment.response';
import type { HomeResponse } from '../src/modules/home/dto/home.response';
import { HOME_NEW_PROBLEMS } from '../src/modules/home/home.service';
import {
  createComment,
  createPost,
  signedInWriter,
} from './community-fixtures';
import {
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { createOrganization } from './organization-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('homepage and user comments', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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

  it('computes the viewer contest scope once per scan and serves the anonymous slice from a 60 s cache', async () => {
    const { user: author } = await person();
    const { user: contestant, session } = await person();
    const running = await createContest(api);
    await makeCurrent(
      api,
      contestant._id,
      (await joinParticipation(api, running._id, contestant._id))._id,
    );
    const secret = await createProblem(api, catalog, {
      code: 'home_scan',
      isPublic: false,
    });
    const post = await createPost(api);
    await createComment(api, {
      page: { type: 'blog', id: post._id },
      author: author._id,
    });
    for (let index = 0; index < 100; index += 1)
      await createComment(api, {
        page: { type: 'problem', id: secret._id },
        author: author._id,
      });
    const participationReads = (
      await profileQueries(api.db, () => home(session))
    ).filter(({ collection }) => collection === 'contestParticipations');
    // 101 rows are six batches of 20; the scope (one participation read) is computed once, not per batch.
    expect(participationReads).toHaveLength(1);
    await home();
    const cached = await profileQueries(api.db, () => home());
    expect(
      cached.filter(({ collection }) => collection === 'comments'),
    ).toEqual([]);
    // A signed-in viewer is never answered from the shared slice.
    const signedIn = await profileQueries(api.db, () => home(session));
    expect(signedIn.some(({ collection }) => collection === 'comments')).toBe(
      true,
    );
  });

  it('never leaks a per-viewer slice through the anonymous cache', async () => {
    const { user: author } = await person();
    const { user: member, session: memberSession } = await person();
    const organization = await createOrganization(api, {}, [member._id]);
    await createProblem(api, catalog, {
      code: 'home_orgthread',
      isOrganizationPrivate: true,
      organizations: [organization._id],
    });
    const problem = await api.problems
      .findOne({ code: 'home_orgthread' })
      .orFail();
    const comment = await createComment(api, {
      page: { type: 'problem', id: problem._id },
      author: author._id,
    });
    expect((await home()).recentComments).toEqual([]);
    expect(
      (await home(memberSession)).recentComments.map(({ id }) => id),
    ).toEqual([comment._id]);
    expect((await home()).recentComments).toEqual([]);
    const outsider = await person();
    expect((await home(outsider.session)).recentComments).toEqual([]);
  });

  it('hides a contest problem thread from its contestants only', async () => {
    const { user: author } = await person();
    const { user: contestant, session: contestantSession } = await person();
    const contestProblemDoc = await createProblem(api, catalog, {
      code: 'home_cpub',
    });
    const contest = await createContest(api, {
      problems: [contestProblem(contestProblemDoc._id, 0)],
    });
    const participation = await joinParticipation(
      api,
      contest._id,
      contestant._id,
    );
    await makeCurrent(api, contestant._id, participation._id);
    const comment = await createComment(api, {
      page: { type: 'problem', id: contestProblemDoc._id },
      author: author._id,
    });
    expect((await home(contestantSession)).recentComments).toEqual([]);
    expect((await home()).recentComments.map(({ id }) => id)).toEqual([
      comment._id,
    ]);
  });

  it('serves new public problems, top users and counts (problems = all live ones)', async () => {
    await api.problems.deleteMany({});
    const organization = await createOrganization(api);
    for (let index = 0; index < 8; index += 1)
      await createProblem(api, catalog, {
        code: `home_${index}`,
        date: new Date(Date.now() - index * 60_000),
      });
    await createProblem(api, catalog, {
      code: 'home_private',
      isPublic: false,
    });
    await createProblem(api, catalog, {
      code: 'home_org',
      isOrganizationPrivate: true,
      organizations: [organization._id],
    });
    await api.users.updateMany(
      {},
      { $set: { performancePoints: 0, contributionPoints: 0 } },
    );
    const { user: best } = await person({
      performancePoints: 500,
      contributionPoints: 7,
    });
    await person({ performancePoints: 400, isUnlisted: true });
    const operations = await profileQueries(api.db, () => home());
    const data = await home();
    expect(data.newProblems.map((problem) => problem.code)).toEqual([
      'home_0',
      'home_1',
      'home_2',
      'home_3',
      'home_4',
      'home_5',
      'home_6',
    ]);
    expect(data.topPerformers.map((user) => user.username)).toEqual([
      best.username,
    ]);
    expect(data.topContributors).toEqual([
      expect.objectContaining({
        username: best.username,
        contributionPoints: 7,
      }),
    ]);
    expect(data.counts).toMatchObject({ problems: 10 });
    const newest = operations.filter(
      ({ collection, operation }) =>
        collection === 'problems' && operation === 'query',
    );
    expect(newest).toHaveLength(1);
    expect(newest[0].planSummary).not.toContain('COLLSCAN');
    expect(newest[0].hasSortStage).toBe(false);
    expect(newest[0].docsExamined).toBeLessThanOrEqual(HOME_NEW_PROBLEMS + 2);
  });

  it('counts only the contests an anonymous visitor can see, through an index', async () => {
    await api.contests.deleteMany({});
    await createContest(api);
    await createContest(api, { isVisible: false });
    await createContest(api, { isPrivate: true });
    const organization = await createOrganization(api);
    await createContest(api, {
      isOrganizationPrivate: true,
      organizations: [organization._id],
    });
    const operations = await profileQueries(api.db, () => home());
    expect((await home()).counts.contests).toBe(1);
    const counted = operations.filter(
      ({ collection }) => collection === 'contests',
    );
    expect(counted.length).toBeGreaterThan(0);
    for (const operation of counted)
      expect(operation.planSummary).not.toContain('COLLSCAN');
    await createContest(api);
    expect((await home()).counts.contests).toBe(2);
  });

  it('gives each top user their first listed organization, never an unlisted one', async () => {
    await api.users.updateMany({}, { $set: { performancePoints: 0 } });
    const listed = await createOrganization(api, { isOpen: false });
    const hidden = await createOrganization(api, { isUnlisted: true });
    await person({ performancePoints: 900, organizations: [listed._id] });
    await person({ performancePoints: 800, organizations: [hidden._id] });
    const { topPerformers } = await home();
    expect(topPerformers[0].organization).toMatchObject({
      slug: listed.slug,
      isOpen: false,
    });
    expect(topPerformers[1].organization).toBeNull();
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
      (second.body as { meta: { nextBefore: string | null } }).meta.nextBefore,
    ).toBeNull();
    await authed(
      api.http().get('/api/internal/users/nobody_at_all/comments'),
      staff,
    ).expect(404);
    await authed(api.http().get(`${url}?before=nope`), staff).expect(400);
  });
});
