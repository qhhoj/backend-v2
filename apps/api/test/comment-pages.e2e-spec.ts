import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { COMMENT_THREADS_PAGE_SIZE } from '@libs/community';
import type { CommentPageType } from '@libs/community';
import { profileQueries } from '@libs/database/testing';
import type { CommentPageResponse } from '../src/modules/comments/core/dto/comment.response';
import type { PostListItemResponse } from '../src/modules/blog/core/dto/post.response';
import {
  commentPageUrl,
  commentUrl,
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
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('comment pages', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterAll(() => api.teardown());

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
    expect(await status('blog', organizationPost._id, memberSession)).toBe(200);
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
    const contestantView = await read('problem', 'pg_cpub', contestantSession);
    expect(contestantView).toMatchObject({
      locked: true,
      comments: [],
      pagination: { total: 0 },
    });
    expect(
      (await read('problem', 'pg_cpub')).comments.map((comment) => comment.id),
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
    expect(view.comments.map((comment) => [comment.id, comment.depth])).toEqual(
      [
        [newer._id, 0],
        [older._id, 0],
        [reply._id, 1],
        [deep._id, 2],
      ],
    );
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

  it('pages roots by 20 and reads through the comment indexes', async () => {
    const { user: author } = await person();
    const post = await createPost(api);
    const page = { type: 'blog' as const, id: post._id };
    const roots = [];
    for (let index = 0; index < 25; index += 1)
      roots.push(await createComment(api, { page, author: author._id }));
    await createComment(api, { page, author: author._id, parent: roots[24] });
    const operations = await profileQueries(api.db, () =>
      read('blog', post._id),
    );
    const reads = operations.filter(
      ({ collection, operation }) =>
        collection === 'comments' && operation === 'query',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => planSummary.includes('IXSCAN')),
    ).toBe(true);
    expect(
      Math.max(...reads.map(({ docsExamined }) => docsExamined)),
    ).toBeLessThanOrEqual(COMMENT_THREADS_PAGE_SIZE + 1);
    expect(
      (await read('blog', post._id, undefined, '?page=2')).comments,
    ).toHaveLength(5);
  });

  it('honours locks and their override, and closes comments in official contest mode', async () => {
    const { session } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.override_comment_lock'],
    });
    const { session: root } = await person({ isSuperuser: true });
    const post = await createPost(api);
    await api.commentLocks.create({ page: { type: 'blog', id: post._id } });
    expect(await read('blog', post._id, session)).toMatchObject({
      locked: true,
      canComment: false,
    });
    expect(await read('blog', post._id, moderator)).toMatchObject({
      locked: false,
      canComment: true,
    });
    const env = api.app.get<Env>(ENV);
    env.officialContestMode = true;
    try {
      expect(await status('blog', post._id, session)).toBe(403);
      expect(await status('blog', post._id, root)).toBe(200);
    } finally {
      env.officialContestMode = false;
    }
  });

  it('counts visible comments on post lists', async () => {
    const { user: author } = await person();
    await api.blogPosts.deleteMany({});
    const post = await createPost(api, { globalPost: true });
    const page = { type: 'blog' as const, id: post._id };
    await createComment(api, { page, author: author._id });
    await createComment(api, { page, author: author._id, hidden: true });
    let items!: PostListItemResponse[];
    const operations = await profileQueries(api.db, async () => {
      items = dataOf<PostListItemResponse[]>(
        await api.http().get('/api/internal/posts').expect(200),
      );
    });
    expect(items[0].commentCount).toBe(1);
    const counts = operations.filter(
      ({ collection, operation }) =>
        collection === 'comments' && operation === 'command',
    );
    expect(counts.length).toBeGreaterThan(0);
    expect(
      counts.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
  });
});
