import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { CONTRIBUTION_POINTS_QUEUE } from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { uuidStr } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { CommentPageResponse } from '../src/modules/comments/core/dto/comment.response';
import type { CommentVoteEntryResponse } from '../src/modules/comments/moderation/dto/comment-vote-entry.response';
import type { VoteResponse } from '../src/modules/contributions/dto/vote.response';
import {
  commentPageUrl,
  commentUrl,
  createComment,
  createPost,
  writer,
} from './community-fixtures';
import { clearRateLimits } from './contest-fixtures';
import { authed, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('comment votes and moderation', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
    await api.teardown();
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

  it('answers 429 over the shared 60/min vote limit', async () => {
    const { user: author } = await person();
    const { session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: author._id,
    });
    for (let index = 0; index < 60; index += 1)
      await vote(comment._id, session, index % 2 ? 1 : -1).expect(200);
    await vote(comment._id, session, 1)
      .expect(429)
      .expect(errorCode('rate_limited'));
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
