import type Redis from 'ioredis';
import { ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
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

describe('homepage, user comments and feeds', () => {
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
  // `buffer(true)` makes superagent keep the XML as text instead of a Buffer body.
  const feed = (kind: string, format: string) =>
    api
      .http()
      .get(`/api/internal/feeds/${kind}/${format}`)
      .buffer(true)
      .expect(200);

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
    const env = api.app.get<Env>(ENV);
    env.officialContestMode = true;
    try {
      expect((await home()).recentComments).toEqual([]);
    } finally {
      env.officialContestMode = false;
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

  it('serves new public problems, top users and counts', async () => {
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
    expect(data.counts).toMatchObject({ problems: 8 });
    const newest = operations.filter(
      ({ collection, operation }) =>
        collection === 'problems' && operation === 'query',
    );
    expect(newest).toHaveLength(1);
    expect(newest[0].planSummary).not.toContain('COLLSCAN');
    expect(newest[0].hasSortStage).toBe(false);
    expect(newest[0].docsExamined).toBeLessThanOrEqual(HOME_NEW_PROBLEMS + 2);
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

  it('keeps org-private and unpublished posts out of the feeds', async () => {
    const { user: author } = await person();
    const organization = await createOrganization(api);
    const shown = await createPost(api, { title: 'Shown post' });
    await createPost(api, {
      title: 'Org secret',
      organization: organization._id,
    });
    await createPost(api, { title: 'Draft secret', visible: false });
    await createPost(api, {
      title: 'Scheduled secret',
      publishOn: new Date(Date.now() + 3_600_000),
    });
    const organizationPost = await createPost(api, {
      title: 'Org page',
      organization: organization._id,
    });
    await createComment(api, {
      page: { type: 'blog', id: shown._id },
      author: author._id,
      bodyHtml: '<p>public words</p>',
    });
    await createComment(api, {
      page: { type: 'blog', id: organizationPost._id },
      author: author._id,
      bodyHtml: '<p>private words</p>',
    });
    await createProblem(api, catalog, {
      code: 'feed_public',
      name: 'Feed Public',
    });
    await createProblem(api, catalog, {
      code: 'feed_private',
      name: 'Feed Private',
      isPublic: false,
    });
    const rss = await feed('blog', 'rss');
    expect(rss.headers['content-type']).toMatch(/^application\/rss\+xml/);
    expect(rss.text).toContain('Shown post');
    expect(rss.text).not.toMatch(
      /Org secret|Draft secret|Org page|Scheduled secret/,
    );
    const atom = await feed('blog', 'atom');
    expect(atom.headers['content-type']).toMatch(/^application\/atom\+xml/);
    expect(atom.text).toContain(`/post/${shown._id}`);
    const comments = (await feed('comments', 'rss')).text;
    expect(comments).toContain('public words');
    expect(comments).not.toContain('private words');
    const problems = (await feed('problems', 'atom')).text;
    expect(problems).toContain('Feed Public');
    expect(problems).not.toContain('Feed Private');
    const cachedRead = await profileQueries(api.db, () => feed('blog', 'rss'));
    expect(
      cachedRead.filter(({ collection }) => collection === 'blogPosts'),
    ).toEqual([]);
    await api.http().get('/api/internal/feeds/blog/json').expect(400);
  });

  it('escapes post titles and drops control characters in the XML', async () => {
    await createPost(api, {
      title: 'Tom & <script>alert(1)</script> \u0001\u0008end',
      contentHtml: '<p>]]></p>',
    });
    const rss = (await feed('blog', 'rss')).text;
    expect(rss).toContain(
      'Tom &amp; &lt;script&gt;alert(1)&lt;/script&gt; end',
    );
    for (const raw of ['<script>', '\u0001', '\u0008', ']]>'])
      expect(rss).not.toContain(raw);
    expect((rss.match(/<item>/g) ?? []).length).toBe(1);
  });
});
