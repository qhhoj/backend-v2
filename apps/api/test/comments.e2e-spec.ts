import {
  COMMENT_THREADS_PAGE_SIZE,
  CONTRIBUTION_POINTS_QUEUE,
  COMMENT_MAX_DEPTH,
  DISCORD_WEBHOOK_QUEUE,
} from '@libs/community';
import type {
  CommentPageResponse,
  CommentDetailResponse,
  CommentLocationResponse,
  CommentResponse,
} from '../src/modules/comments/core/dto/comment.response';
import type { CommentRevisionResponse } from '../src/modules/comments/posting/dto/comment-revision.response';
import type { CommentPreviewResponse } from '../src/modules/comments/posting/dto/comment-preview.response';
import type { CommentReportQueueItemResponse } from '../src/modules/comments/reports/dto/comment-report-queue-item.response';
import {
  commentPageUrl,
  commentUrl,
  createComment,
  createPost,
  signedInWriter,
  writer,
  ghost,
} from './community-fixtures';
import {
  clearRateLimits,
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  seedCatalog,
  loginAs,
} from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import type { ContributionPointsJob, DiscordWebhookJob } from '@libs/community';
import { uuidStr } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { CommentVoteEntryResponse } from '../src/modules/comments/moderation/dto/comment-vote-entry.response';
import type { VoteResponse } from '../src/modules/contributions/dto/vote.response';
import { CommentPostingService } from '../src/modules/comments/posting/comment-posting.service';
import { CommentsRepository } from '../src/modules/comments/core/comments.repository';
import { RevisionsRepository } from '../src/modules/problems/core/revisions.repository';

let api: ApiTest;
beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

const MODERATOR = { permissions: ['judge.change_comment'] };

describe('comment preview, post blocks, hidden listings, delete, reports, locate and numbers', () => {
  let userCount = 0;
  const person = (extra = {}) =>
    signedInWriter(api, `lifecycle${(userCount += 1)}`, extra);
  const listing = async (postId: string, session?: TestSession, query = '') => {
    const request = api.http().get(commentPageUrl('blog', postId, query));
    return dataOf<CommentPageResponse>(
      await (session ? authed(request, session) : request).expect(200),
    );
  };
  const preview = (session: TestSession, body: unknown) =>
    authed(api.http().post('/api/internal/comments/preview'), session).send({
      body,
    });
  const post = (postId: string, session: TestSession, body: object) =>
    authed(api.http().post(commentPageUrl('blog', postId)), session).send(body);
  const remove = (id: string, session: TestSession) =>
    authed(api.http().delete(commentUrl(id)), session);
  const hide = (id: string, session: TestSession, hidden: boolean) =>
    authed(api.http().post(commentUrl(id, '/hidden')), session).send({
      hidden,
    });
  const report = (id: string, session: TestSession, body: object) =>
    authed(api.http().post(commentUrl(id, '/reports')), session).send(body);
  const queue = async (session: TestSession) =>
    dataOf<CommentReportQueueItemResponse[]>(
      await authed(
        api.http().get('/api/internal/comments/reports'),
        session,
      ).expect(200),
    );
  const blogComment = (postId: string, author: string, extra = {}) =>
    createComment(api, {
      page: { type: 'blog', id: postId },
      author,
      ...extra,
    });

  beforeAll(async () => {
    await api.reset();
  });
  beforeEach(() => clearRateLimits(api));

  describe('preview', () => {
    it('renders like posting does, for users who may comment', async () => {
      const { session } = await person();
      const page = await createPost(api);
      const body = '<b>raw</b> **bold** $x$';
      const { bodyHtml } = dataOf<CommentPreviewResponse>(
        await preview(session, body).expect(200),
      );
      const posted = dataOf<CommentResponse>(
        await post(page._id, session, { body }).expect(201),
      );
      expect(bodyHtml).toBe(posted.bodyHtml);
      expect(bodyHtml).toContain('&lt;b&gt;raw&lt;/b&gt;');
    });

    it('refuses blank, oversize, signed-out, muted and new users', async () => {
      const { session } = await person();
      await preview(session, '   ')
        .expect(400)
        .expect(errorCode('validation_failed'));
      await preview(session, 'x'.repeat(8193)).expect(400);
      await api
        .http()
        .post('/api/internal/comments/preview')
        .send({ body: 'x' })
        .expect(401);
      await preview((await person({ mute: true })).session, 'x').expect(403);
      await preview((await person({ problemCount: 1 })).session, 'x').expect(
        403,
      );
    });
  });

  describe('post block', () => {
    it('names the reason posting refuses, with solved/required counts', async () => {
      const page = await createPost(api);
      expect((await listing(page._id)).postBlock).toEqual({
        reason: 'signed_out',
        solved: null,
        required: null,
      });
      const newcomer = await person({ problemCount: 3 });
      const newcomerView = await listing(page._id, newcomer.session);
      expect(newcomerView.postBlock).toEqual({
        reason: 'needs_solved',
        solved: 3,
        required: 5,
      });
      expect(newcomerView.canComment).toBe(false);
      await post(page._id, newcomer.session, { body: 'x' }).expect(403);

      const muted = await person({ mute: true, problemCount: 1 });
      expect((await listing(page._id, muted.session)).postBlock?.reason).toBe(
        'muted',
      );
      await post(page._id, muted.session, { body: 'x' }).expect(403);

      const { session } = await person();
      const open = await listing(page._id, session);
      expect(open).toMatchObject({
        postBlock: null,
        canComment: true,
        locked: false,
        pageLocked: false,
      });
    });

    it('reports a lock as `locked` to everyone but lock overriders, who still see `pageLocked`', async () => {
      const page = await createPost(api);
      await api.commentLocks.create({ page: { type: 'blog', id: page._id } });
      const { session } = await person();
      expect(await listing(page._id, session)).toMatchObject({
        locked: true,
        pageLocked: true,
        canComment: false,
        postBlock: { reason: 'locked' },
      });
      await post(page._id, session, { body: 'x' }).expect(403);
      const overrider = await person({
        permissions: ['judge.change_comment', 'judge.override_comment_lock'],
      });
      expect(await listing(page._id, overrider.session)).toMatchObject({
        locked: false,
        pageLocked: true,
        canComment: true,
        postBlock: null,
      });
    });

    it('says `contest` on a problem of the viewer’s running contest', async () => {
      const { user, session } = await person();
      const problem = await createProblem(api, await seedCatalog(api), {
        code: 'life_conly',
        isPublic: false,
      });
      const contest = await createContest(api, {
        key: 'life_running',
        problems: [contestProblem(problem._id, 0)],
      });
      await makeCurrent(
        api,
        user._id,
        (await joinParticipation(api, contest._id, user._id))._id,
      );
      const view = dataOf<CommentPageResponse>(
        await authed(
          api.http().get(commentPageUrl('problem', 'life_conly')),
          session,
        ).expect(200),
      );
      expect(view.postBlock?.reason).toBe('contest');
    });
  });

  describe('hidden comments', () => {
    it('lists them to moderators only, flagged with the hiding moderator, and audits hide and unhide', async () => {
      const { user: author } = await person();
      const { user: modUser, session: moderator } = await person(MODERATOR);
      const { session: reader } = await person();
      const page = await createPost(api);
      const root = await blogComment(page._id, author._id, { body: 'root' });
      const reply = await blogComment(page._id, author._id, { parent: root });
      await hide(root._id, moderator, true).expect(200);

      for (const session of [reader, undefined])
        expect((await listing(page._id, session)).comments).toEqual([]);
      const modView = await listing(page._id, moderator);
      expect(modView.pagination.total).toBe(1);
      expect(modView.comments.map((comment) => comment.id)).toEqual([
        root._id,
        reply._id,
      ]);
      for (const comment of modView.comments)
        expect(comment).toMatchObject({
          hidden: true,
          hiddenBy: { id: modUser._id },
          bodyHtml: '<p>text</p>',
        });

      await hide(root._id, moderator, false).expect(200);
      const restored = await listing(page._id, reader);
      expect(restored.comments.map((comment) => comment.hidden)).toEqual([
        false,
        false,
      ]);
      expect(restored.comments[0].hiddenBy).toBeNull();
      const audit = await api.revisions
        .find({ entity: 'comment', entityId: root._id })
        .sort({ createdAt: 1 })
        .lean();
      expect(audit.map((row) => [row.action, String(row.userId)])).toEqual([
        ['hide', modUser._id],
        ['unhide', modUser._id],
      ]);
    });
  });

  describe('delete', () => {
    it('lets the author delete their comment into a placeholder that keeps its replies', async () => {
      const { user: author, session } = await person();
      const { user: other, session: otherSession } = await person();
      const page = await createPost(api);
      const root = await blogComment(page._id, author._id, { body: 'secret' });
      await blogComment(page._id, other._id, { parent: root });
      await remove(root._id, otherSession)
        .expect(403)
        .expect(errorCode('forbidden'));
      const placeholder = dataOf<CommentResponse>(
        await remove(root._id, session).expect(200),
      );
      expect(placeholder).toMatchObject({
        deleted: true,
        bodyHtml: '',
        body: null,
        canEdit: false,
        canDelete: false,
      });
      const view = await listing(page._id);
      expect(view.comments).toHaveLength(2);
      expect(view.comments[0]).toMatchObject({ id: root._id, deleted: true });
      expect(JSON.stringify(view)).not.toContain('secret');

      await remove(root._id, session).expect(404);
      await authed(api.http().patch(commentUrl(root._id)), session)
        .send({ body: 'back' })
        .expect(404);
      await authed(api.http().put(commentUrl(root._id, '/vote')), otherSession)
        .send({ score: 1 })
        .expect(404);
      await post(page._id, otherSession, {
        body: 'reply',
        parentId: root._id,
      }).expect(404);
      await report(root._id, otherSession, { reason: 'spam' }).expect(404);
    });

    it('lets moderators delete any comment, keeps its history for them only, and records the delete', async () => {
      const { user: author, session: authorSession } = await person();
      const { user: modUser, session: moderator } = await person(MODERATOR);
      const page = await createPost(api);
      const comment = await blogComment(page._id, author._id);
      await authed(api.http().patch(commentUrl(comment._id)), authorSession)
        .send({ body: 'edited text' })
        .expect(200);
      await remove(comment._id, moderator).expect(200);
      const stored = await api.comments.findById(comment._id).lean();
      expect(String(stored?.deletedBy)).toBe(modUser._id);
      await api.http().get(commentUrl(comment._id, '/revisions')).expect(404);
      const history = dataOf<CommentRevisionResponse[]>(
        await authed(
          api.http().get(commentUrl(comment._id, '/revisions')),
          moderator,
        ).expect(200),
      );
      expect(history.map((row) => row.after)).toEqual(['edited text']);
      const deleteRow = await api.revisions
        .findOne({ entityId: comment._id, action: 'delete' })
        .lean();
      expect(deleteRow?.changes.body.before).toBe('edited text');
    });
  });

  describe('reports', () => {
    it('takes one report per user, never of their own comment, and queues it for moderators', async () => {
      const { user: author, session: authorSession } = await person();
      const { user: reporter, session } = await person();
      const { session: second } = await person();
      const { session: moderator } = await person(MODERATOR);
      const page = await createPost(api);
      const comment = await blogComment(page._id, author._id, {
        body: 'buy cheap stuff',
      });
      await report(comment._id, authorSession, { reason: 'spam' }).expect(403);
      await report(comment._id, session, { reason: 'nonsense' }).expect(400);
      await report(comment._id, session, {
        reason: 'spam',
        note: ' ads ',
      }).expect(204);
      await report(comment._id, session, { reason: 'abuse' })
        .expect(409)
        .expect(errorCode('conflict'));
      await report(comment._id, second, { reason: 'offTopic' }).expect(204);

      await authed(
        api.http().get('/api/internal/comments/reports'),
        session,
      ).expect(403);
      const items = await queue(moderator);
      const item = items.find((entry) => entry.comment.id === comment._id);
      expect(item).toMatchObject({
        comment: { excerpt: 'buy cheap stuff', author: { id: author._id } },
        page: { type: 'blog', key: page._id },
        reporterCount: 2,
      });
      expect(item?.reports[0]).toMatchObject({
        reporter: { id: reporter._id },
        reason: 'spam',
        note: 'ads',
      });
    });

    it('settles all open reports of a comment at once, moderators only', async () => {
      const { user: author } = await person();
      const { session } = await person();
      const { session: moderator } = await person(MODERATOR);
      const page = await createPost(api);
      const comment = await blogComment(page._id, author._id);
      await report(comment._id, session, { reason: 'abuse' }).expect(204);
      const settle = (as: TestSession, outcome: string) =>
        authed(
          api.http().post(commentUrl(comment._id, '/reports/settle')),
          as,
        ).send({ outcome });
      await settle(session, 'resolved').expect(403);
      await settle(moderator, 'ignored').expect(400);
      await settle(moderator, 'dismissed').expect(204);
      expect(
        (await queue(moderator)).some(
          (entry) => entry.comment.id === comment._id,
        ),
      ).toBe(false);
      await settle(moderator, 'resolved').expect(404);
    });
  });

  describe('locate', () => {
    it('names the listing page of a reply’s thread, counting hidden threads for moderators only', async () => {
      const { user: author } = await person();
      const { session: moderator } = await person(MODERATOR);
      const page = await createPost(api);
      const target = await blogComment(page._id, author._id);
      const reply = await blogComment(page._id, author._id, { parent: target });
      // Newer threads push the target to page 2 (newest first): one is hidden.
      for (let index = 0; index < COMMENT_THREADS_PAGE_SIZE; index += 1)
        await blogComment(page._id, author._id, { hidden: index === 0 });
      const locate = async (session?: TestSession) => {
        const request = api.http().get(commentUrl(reply._id, '/location'));
        return dataOf<CommentLocationResponse>(
          await (session ? authed(request, session) : request).expect(200),
        );
      };
      expect(await locate()).toMatchObject({
        page: { type: 'blog', key: page._id },
        pageNumber: 1,
      });
      expect((await locate(moderator)).pageNumber).toBe(2);
      const listed = await listing(page._id, moderator, '?page=2');
      expect(listed.comments.map((comment) => comment.id)).toContain(reply._id);
      const hiddenOne = await blogComment(page._id, author._id, {
        hidden: true,
      });
      await api.http().get(commentUrl(hiddenOne._id, '/location')).expect(404);
    });
  });

  describe('numbers', () => {
    it('numbers new comments per page after the comments already there', async () => {
      const { user: author, session } = await person();
      const page = await createPost(api);
      const other = await createPost(api);
      await blogComment(page._id, author._id);
      await blogComment(page._id, author._id);
      const first = dataOf<CommentResponse>(
        await post(page._id, session, { body: 'one' }).expect(201),
      );
      const second = dataOf<CommentResponse>(
        await post(page._id, session, {
          body: 'two',
          parentId: first.id,
        }).expect(201),
      );
      const elsewhere = dataOf<CommentResponse>(
        await post(other._id, session, { body: 'x' }).expect(201),
      );
      expect([first.number, second.number, elsewhere.number]).toEqual([
        3, 4, 1,
      ]);
      const detail = dataOf<CommentDetailResponse>(
        await api.http().get(commentUrl(second.id)).expect(200),
      );
      expect(detail.number).toBe(4);
    });
  });
});

describe('comment votes and moderation', () => {
  let contributions: Queue<ContributionPointsJob>;
  let userCount = 0;
  const person = async (extra = {}) => {
    const user = await writer(api, `moderated${(userCount += 1)}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const vote = (id: string, session: TestSession, score: number) =>
    authed(api.http().put(commentUrl(id, '/vote')), session).send({ score });
  const hide = (id: string, session: TestSession, hidden: boolean) =>
    authed(api.http().post(commentUrl(id, '/hidden')), session).send({
      hidden,
    });
  const queuedUsers = async () =>
    (await contributions.getJobs(['waiting']))
      .map((job) => job.data.userId)
      .sort();

  beforeAll(async () => {
    await api.reset();
    contributions = api.app.get(getQueueToken(CONTRIBUTION_POINTS_QUEUE));
  });
  const clearQueued = async () => {
    await contributions.drain();
    const redis = api.app.get<Redis>(REDIS);
    const pending = await redis.keys('contribution-points:pending:*');
    if (pending.length) await redis.del(...pending);
  };
  beforeEach(async () => {
    await clearRateLimits(api);
    await clearQueued();
  });
  afterAll(async () => {
    await contributions.obliterate({ force: true });
  });

  it('votes on readable, visible comments of others only', async () => {
    const { user: author, session: authorSession } = await person();
    const { session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: author._id,
    });
    expect(
      dataOf<VoteResponse>(await vote(comment._id, session, -1).expect(200)),
    ).toEqual({ score: -1, viewerVote: -1 });
    await vote(comment._id, authorSession, 1).expect(403);
    const hidden = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: author._id,
      hidden: true,
    });
    await vote(hidden._id, session, 1).expect(404);
    const draft = await createPost(api, {
      authors: [author._id],
      visible: false,
    });
    const onDraft = await createComment(api, {
      page: { type: 'blog', id: draft._id },
      author: author._id,
    });
    await vote(onDraft._id, session, 1).expect(404);
    await api.commentLocks.create({ page: { type: 'blog', id: page._id } });
    await vote(comment._id, session, 1).expect(200);
    await api.commentLocks.deleteMany({ 'page.id': page._id });
    await api.setSetting('contest.officialMode', true);
    try {
      await vote(comment._id, session, 1).expect(403);
    } finally {
      await api.setSetting('contest.officialMode', false);
    }
  });

  it('hides and unhides exactly the subtree and recomputes its authors', async () => {
    const authors = await Promise.all([person(), person(), person(), person()]);
    const [rootAuthor, childAuthor, grandchildAuthor, siblingAuthor] =
      authors.map(({ user }) => user._id);
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const at = { type: 'blog' as const, id: page._id };
    const root = await createComment(api, { page: at, author: rootAuthor });
    const child = await createComment(api, {
      page: at,
      author: childAuthor,
      parent: root,
    });
    const grandchild = await createComment(api, {
      page: at,
      author: grandchildAuthor,
      parent: child,
    });
    const sibling = await createComment(api, {
      page: at,
      author: siblingAuthor,
      parent: root,
    });
    const otherRoot = await createComment(api, {
      page: at,
      author: siblingAuthor,
    });
    await hide(child._id, authors[0].session, true).expect(403);
    const operations = await profileQueries(api.db, () =>
      hide(child._id, moderator, true).expect(200),
    );
    const hiddenOf = async () =>
      Object.fromEntries(
        (await api.comments.find({ 'page.id': page._id }).lean()).map((row) => [
          uuidStr(row._id),
          row.hidden,
        ]),
      );
    expect(await hiddenOf()).toEqual({
      [root._id]: false,
      [child._id]: true,
      [grandchild._id]: true,
      [sibling._id]: false,
      [otherRoot._id]: false,
    });
    expect(await queuedUsers()).toEqual([childAuthor, grandchildAuthor].sort());
    const writes = operations.filter(
      ({ collection, operation }) =>
        collection === 'comments' && operation === 'update',
    );
    expect(
      writes.every(({ planSummary }) => planSummary.includes('IXSCAN')),
    ).toBe(true);
    expect(
      Math.max(...writes.map(({ docsExamined }) => docsExamined)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.max(...writes.map(({ keysExamined }) => keysExamined)),
    ).toBeLessThanOrEqual(4);
    const view = dataOf<CommentPageResponse>(
      await api.http().get(commentPageUrl('blog', page._id)).expect(200),
    );
    expect(view.comments.map((comment) => comment.id).sort()).toEqual(
      [root._id, sibling._id, otherRoot._id].sort(),
    );
    await clearQueued();
    await hide(grandchild._id, moderator, false)
      .expect(409)
      .expect(errorCode('conflict'));
    expect((await api.comments.findById(grandchild._id).lean())?.hidden).toBe(
      true,
    );
    expect(await queuedUsers()).toEqual([]);
    await hide(child._id, moderator, false).expect(200);
    expect(Object.values(await hiddenOf())).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(await queuedUsers()).toEqual([childAuthor, grandchildAuthor].sort());
  });

  it('unhides only what the unhidden comment hid, keeping separately hidden descendants hidden', async () => {
    const [rootAuthor, childAuthor, grandchildAuthor, siblingAuthor] = (
      await Promise.all([person(), person(), person(), person()])
    ).map(({ user }) => user._id);
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const at = { type: 'blog' as const, id: page._id };
    const root = await createComment(api, { page: at, author: rootAuthor });
    const child = await createComment(api, {
      page: at,
      author: childAuthor,
      parent: root,
    });
    const grandchild = await createComment(api, {
      page: at,
      author: grandchildAuthor,
      parent: child,
    });
    const sibling = await createComment(api, {
      page: at,
      author: siblingAuthor,
      parent: root,
    });
    const hiddenIds = async () =>
      (await api.comments.find({ 'page.id': page._id, hidden: true }).lean())
        .map((row) => uuidStr(row._id))
        .sort();
    await hide(child._id, moderator, true).expect(200);
    await hide(root._id, moderator, true).expect(200);
    expect(await hiddenIds()).toEqual(
      [root._id, child._id, grandchild._id, sibling._id].sort(),
    );
    await clearQueued();
    await hide(root._id, moderator, false).expect(200);
    expect(await hiddenIds()).toEqual([child._id, grandchild._id].sort());
    expect(await queuedUsers()).toEqual(
      [rootAuthor, childAuthor, grandchildAuthor, siblingAuthor].sort(),
    );
    await hide(child._id, moderator, false).expect(200);
    expect(await hiddenIds()).toEqual([]);
    expect(
      (await api.comments.findById(grandchild._id).lean())?.hiddenBy,
    ).toBeNull();
  });

  it('refuses moderation in official contest mode without touching the comment', async () => {
    const { user: author } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: author._id,
    });
    await api.setSetting('contest.officialMode', true);
    try {
      await hide(comment._id, moderator, true).expect(403);
      await authed(
        api.http().put(commentPageUrl('blog', page._id, '/lock')),
        moderator,
      ).expect(403);
      await authed(
        api.http().get(commentUrl(comment._id, '/votes')),
        moderator,
      ).expect(403);
    } finally {
      await api.setSetting('contest.officialMode', false);
    }
    expect((await api.comments.findById(comment._id).lean())?.hidden).toBe(
      false,
    );
    expect(await api.commentLocks.countDocuments({ 'page.id': page._id })).toBe(
      0,
    );
  });

  it('locks and unlocks a page for change_comment only', async () => {
    const { session } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const lockUrl = commentPageUrl('blog', page._id, '/lock');
    await authed(api.http().put(lockUrl), session).expect(403);
    await authed(api.http().put(lockUrl), moderator).expect(204);
    await authed(api.http().put(lockUrl), moderator).expect(204);
    expect(
      dataOf<CommentPageResponse>(
        await authed(
          api.http().get(commentPageUrl('blog', page._id)),
          session,
        ).expect(200),
      ).locked,
    ).toBe(true);
    await authed(api.http().delete(lockUrl), moderator).expect(204);
    expect(await api.commentLocks.countDocuments({ 'page.id': page._id })).toBe(
      0,
    );
    await authed(
      api.http().put(commentPageUrl('blog', 'not-a-uuid', '/lock')),
      moderator,
    ).expect(404);
  });

  it('lists the votes of a comment to change_comment only', async () => {
    const { user: author } = await person();
    const { user: voter, session } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: author._id,
    });
    await vote(comment._id, session, 1).expect(200);
    await authed(
      api.http().get(commentUrl(comment._id, '/votes')),
      session,
    ).expect(403);
    expect(
      dataOf<CommentVoteEntryResponse[]>(
        await authed(
          api.http().get(commentUrl(comment._id, '/votes')),
          moderator,
        ).expect(200),
      ),
    ).toEqual([
      {
        voter: { id: voter._id, username: voter.username, rating: null },
        score: 1,
      },
    ]);
  });
});

describe('comment posting and editing', () => {
  let discord: Queue<DiscordWebhookJob>;
  let userCount = 0;
  const person = async (extra = {}) => {
    const user = await writer(api, `commenter${(userCount += 1)}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const post = (postId: string, session: TestSession, body: object) =>
    authed(api.http().post(commentPageUrl('blog', postId)), session).send(body);
  const edit = (id: string, session: TestSession, body: string) =>
    authed(api.http().patch(commentUrl(id)), session).send({ body });

  beforeAll(async () => {
    await api.reset();
    await api.setSetting('discord.webhooks', {
      on_new_comment: 'http://127.0.0.1:9/hook',
    });
    discord = api.app.get(getQueueToken(DISCORD_WEBHOOK_QUEUE));
  });
  beforeEach(async () => {
    await clearRateLimits(api);
    await discord.drain();
  });
  afterAll(async () => {
    await discord.obliterate({ force: true });
  });

  it('renders the body in the user style and announces comments on public pages', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const created = dataOf<CommentResponse>(
      await post(page._id, session, { body: '<b>raw</b> **bold**' }).expect(
        201,
      ),
    );
    expect(created.bodyHtml).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(created.bodyHtml).toContain('<strong>bold</strong>');
    expect(created).toMatchObject({
      author: { id: user._id },
      depth: 0,
      parentId: null,
      score: 0,
    });
    const [job] = (await discord.getJobs(['waiting'])).map(
      (queued) => queued.data,
    );
    expect(job).toMatchObject({
      event: 'on_new_comment',
      message: {
        title: `New comment http://localhost:5173/post/${page._id}#comment-${created.id}`,
      },
    });
    const draft = await createPost(api, {
      authors: [user._id],
      visible: false,
    });
    await post(draft._id, session, { body: 'private note' }).expect(201);
    expect(await discord.getWaitingCount()).toBe(1);
  });

  it('refuses bad parents', async () => {
    const { user, session } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const elsewhere = await createPost(api);
    const foreign = await createComment(api, {
      page: { type: 'blog', id: elsewhere._id },
      author: user._id,
    });
    const hidden = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      hidden: true,
    });
    const old = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    await api.comments.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 366 * 86_400_000) } },
      { overwriteImmutable: true, timestamps: false },
    );
    await post(page._id, session, { body: 'x', parentId: foreign._id }).expect(
      404,
    );
    await post(page._id, session, { body: 'x', parentId: hidden._id }).expect(
      404,
    );
    await post(page._id, session, { body: 'x', parentId: 'nope' }).expect(400);
    await post(page._id, session, { body: 'x', parentId: old._id })
      .expect(403)
      .expect(errorCode('forbidden'));
    const reply = dataOf<CommentResponse>(
      await post(page._id, moderator, { body: 'x', parentId: old._id }).expect(
        201,
      ),
    );
    expect(reply).toMatchObject({ parentId: old._id, depth: 1 });
    let deepest = old;
    for (let depth = 1; depth <= COMMENT_MAX_DEPTH; depth += 1)
      deepest = await createComment(api, {
        page: { type: 'blog', id: page._id },
        author: user._id,
        parent: deepest,
      });
    const tooDeep = await post(page._id, moderator, {
      body: 'x',
      parentId: deepest._id,
    }).expect(400);
    expect(
      (tooDeep.body as { error: { fields: object } }).error.fields,
    ).toHaveProperty('parentId');
  });

  it('answers 401 when the user vanished between the session check and the write', async () => {
    const { user } = await person();
    const page = await createPost(api);
    const own = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const principal = ghost(user);
    await api.users.deleteOne({ _id: user._id });
    const posting = api.app.get(CommentPostingService);
    await expect(
      posting.create(principal, { type: 'blog', key: page._id }, { body: 'x' }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    await expect(posting.edit(principal, own._id, 'y')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('gates posting on solves, mute, locks, official mode, sign-in, page access and body size', async () => {
    const { session } = await person();
    const page = await createPost(api);
    await post(page._id, (await person({ problemCount: 4 })).session, {
      body: 'x',
    }).expect(403);
    await post(page._id, (await person({ mute: true })).session, {
      body: 'x',
    }).expect(403);
    await api
      .http()
      .post(commentPageUrl('blog', page._id))
      .send({ body: 'x' })
      .expect(401);
    await post((await createPost(api, { visible: false }))._id, session, {
      body: 'x',
    }).expect(404);
    await post(page._id, session, { body: '' }).expect(400);
    await post(page._id, session, { body: ' \n\t ' }).expect(400);
    await post(page._id, session, { body: 'x'.repeat(8193) }).expect(400);
    await api.commentLocks.create({ page: { type: 'blog', id: page._id } });
    await post(page._id, session, { body: 'x' }).expect(403);
    await post(
      page._id,
      (await person({ permissions: ['judge.override_comment_lock'] })).session,
      { body: 'x' },
    ).expect(201);
    const open = await createPost(api);
    await api.setSetting('contest.officialMode', true);
    try {
      await post(open._id, session, { body: 'x' }).expect(403);
    } finally {
      await api.setSetting('contest.officialMode', false);
    }
  });

  it('limits a user to 10 comments in 5 minutes', async () => {
    const { session } = await person();
    const page = await createPost(api);
    for (let index = 0; index < 10; index += 1)
      await post(page._id, session, { body: `comment ${index}` }).expect(201);
    await post(page._id, session, { body: 'one too many' })
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('limits a user to 20 comment edits in 5 minutes; a refused edit costs nothing', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const conflict = jest
      .spyOn(api.app.get(CommentsRepository), 'updateBodyIfRevision')
      .mockResolvedValueOnce(false);
    await edit(comment._id, session, 'conflict').expect(409);
    conflict.mockRestore();
    for (let index = 0; index < 20; index += 1)
      await edit(comment._id, session, `edit ${index}`).expect(200);
    await edit(comment._id, session, 'one too many')
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('edits with a revision row per accepted edit, for the author and change_comment only', async () => {
    const { user, session } = await person();
    const { session: other } = await person();
    const { user: moderatorUser, session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      body: 'first',
    });
    const edited = dataOf<CommentResponse>(
      await edit(comment._id, session, '*second*').expect(200),
    );
    expect(edited).toMatchObject({ revisions: 1 });
    expect(edited.bodyHtml).toContain('<em>second</em>');
    await edit(comment._id, other, 'mine now').expect(403);
    await edit(comment._id, moderator, 'moderated').expect(200);
    const history = dataOf<CommentRevisionResponse[]>(
      await api.http().get(commentUrl(comment._id, '/revisions')).expect(200),
    );
    expect(history[0]).toMatchObject({
      editor: { id: moderatorUser._id },
    });
    expect(history[1].editor).toMatchObject({ id: user._id });
    expect(new Date(history[0].at) >= new Date(history[1].at)).toBe(true);
    expect(history.map((entry) => [entry.before, entry.after])).toEqual([
      ['*second*', 'moderated'],
      ['first', '*second*'],
    ]);
    const statuses = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        edit(comment._id, session, `race ${index}`).then(
          (response) => response.status,
        ),
      ),
    );
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(
      true,
    );
    const stored = (await api.comments.findById(comment._id).lean())!;
    expect(stored.revisions).toBe(
      2 + statuses.filter((status) => status === 200).length,
    );
    expect(
      await api.revisions.countDocuments({
        entity: 'comment',
        entityId: comment._id,
      }),
    ).toBe(stored.revisions);
    await api.users.updateOne({ _id: user._id }, { mute: true });
    await edit(comment._id, session, 'muted').expect(403);
  });

  it('keeps hidden comments and their history to change_comment', async () => {
    const { user } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const hidden = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      hidden: true,
    });
    await api.http().get(commentUrl(hidden._id, '/revisions')).expect(404);
    await authed(
      api.http().get(commentUrl(hidden._id, '/revisions')),
      moderator,
    ).expect(200);
    await edit(hidden._id, await loginAs(api, user._id), 'back').expect(404);
    await api.http().get(commentUrl(hidden._id)).expect(404);
    await authed(api.http().get(commentUrl(hidden._id)), moderator).expect(200);
  });

  it('refuses posting on a problem of a started contest, and edits no thread there', async () => {
    const { user, session } = await person();
    const problem = await createProblem(api, await seedCatalog(api), {
      code: 'post_conly',
      isPublic: false,
    });
    const contest = await createContest(api, {
      key: 'post_running',
      problems: [contestProblem(problem._id, 0)],
    });
    await makeCurrent(
      api,
      user._id,
      (await joinParticipation(api, contest._id, user._id))._id,
    );
    const existing = await createComment(api, {
      page: { type: 'problem', id: problem._id },
      author: user._id,
    });
    await authed(
      api.http().post(commentPageUrl('problem', 'post_conly')),
      session,
    )
      .send({ body: 'x' })
      .expect(403);
    await authed(api.http().patch(commentUrl(existing._id)), session)
      .send({ body: 'edited' })
      .expect(404);
  });

  it('hides a reply whose parent was hidden while it was written', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const parent = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const repository = api.app.get(CommentsRepository);
    const create = repository.create.bind(repository);
    const spy = jest
      .spyOn(CommentsRepository.prototype, 'create')
      .mockImplementationOnce(async (fields) => {
        await api.comments.updateOne({ _id: parent._id }, { hidden: true });
        return create(fields);
      });
    try {
      const reply = dataOf<{ id: string }>(
        await post(page._id, session, {
          body: 'racing',
          parentId: parent._id,
        }).expect(201),
      );
      expect(await api.comments.findById(reply.id).lean()).toMatchObject({
        hidden: true,
      });
      expect(await discord.getWaitingCount()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the body unchanged when its revision row cannot be written', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      body: 'first',
    });
    const spy = jest
      .spyOn(RevisionsRepository.prototype, 'append')
      .mockRejectedValueOnce(new Error('revision store down'));
    try {
      await edit(comment._id, session, 'lost').expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await api.comments.findById(comment._id).lean()).toMatchObject({
      body: 'first',
      revisions: 0,
    });
  });
});
