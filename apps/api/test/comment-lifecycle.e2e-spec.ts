import { COMMENT_THREADS_PAGE_SIZE } from '@libs/community';

import type { CommentPageResponse } from '../src/modules/comments/core/dto/comment.response';

import type {
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
} from './community-fixtures';

import {
  clearRateLimits,
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';

import { authed, createProblem, seedCatalog } from './problem-fixtures';

import type { TestSession } from './problem-fixtures';

import { dataOf } from './submission-fixtures';

import { errorCode, setupApiTest } from './setup';

import type { ApiTest } from './setup';

const MODERATOR = { permissions: ['judge.change_comment'] };

describe('comment preview, post blocks, hidden listings, delete, reports, locate and numbers', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
  });
  beforeEach(() => clearRateLimits(api));
  afterAll(() => api.teardown());

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
