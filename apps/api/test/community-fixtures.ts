import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { childPath, CONTRIBUTION_POINTS_QUEUE, rootOf } from '@libs/community';
import type { CommentPage, CommentPageType } from '@libs/community';
import { newId } from '@libs/database';
import type { BlogPost, Comment, User } from '@libs/database';
import { createUserWith, loginAs } from './problem-fixtures';
import type { ApiTest } from './setup';

let postCount = 0;

/** A visible personal post published a minute ago unless `overrides` say otherwise. */
export const createPost = (api: ApiTest, overrides: Partial<BlogPost> = {}) =>
  api.blogPosts.create({
    title: `Post ${(postCount += 1)}`,
    slug: 'post',
    publishOn: new Date(Date.now() - 60_000),
    visible: true,
    content: 'Hello',
    contentHtml: '<p>Hello</p>',
    ...overrides,
  });

/** A comment written straight to Mongo with its path, thread and parent filled in. */
export function createComment(
  api: ApiTest,
  {
    page,
    author,
    parent,
    ...overrides
  }: { page: CommentPage; author: string; parent?: Comment } & Partial<Comment>,
) {
  const commentId = newId();
  const path = childPath(parent ? parent.path : null, commentId);
  return api.comments.create({
    _id: commentId,
    page,
    author,
    parentId: parent ? parent._id : null,
    threadId: rootOf(path),
    path,
    body: 'text',
    bodyHtml: '<p>text</p>',
    ...overrides,
  });
}

/** A user past every interaction gate (10 solved). */
export const writer = (
  api: ApiTest,
  username: string,
  extra: Partial<User> = {},
) => createUserWith(api, username, { problemCount: 10, ...extra });

/** A `writer` with a ready session. */
export async function signedInWriter(
  api: ApiTest,
  username: string,
  extra: Partial<User> = {},
) {
  const user = await writer(api, username, extra);
  return { user, session: await loginAs(api, user._id) };
}

export const postUrl = (id: string, suffix = '') =>
  `/api/internal/posts/${id}${suffix}`;
export const commentPageUrl = (
  type: CommentPageType,
  key: string,
  suffix = '',
) => `/api/internal/comments/pages/${type}/${key}${suffix}`;
export const commentUrl = (id: string, suffix = '') =>
  `/api/internal/comments/${id}${suffix}`;

/** Empties the contribution-points queue and its pending flags so a spec starts from no waiting recompute. */
export async function clearContributionQueue(api: ApiTest) {
  await api.app.get<Queue>(getQueueToken(CONTRIBUTION_POINTS_QUEUE)).drain();
  const redis = api.app.get<Redis>(REDIS);
  const pending = await redis.keys('contribution-points:pending:*');
  if (pending.length) await redis.del(...pending);
}
