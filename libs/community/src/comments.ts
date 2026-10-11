import { COMMENT_PAGE_TYPES, uuidStr } from '@libs/database';
import type { CommentPageType } from '@libs/database';

export { COMMENT_PAGE_TYPES };
export type { CommentPageType };

/** Legacy `Comment.body` max length. */
export const COMMENT_MAX_LENGTH = 8192;
/** New: `path` grows by 37 characters a level; legacy MPTT had no cap. */
export const COMMENT_MAX_DEPTH = 100;
/** Legacy `DMOJ_COMMENT_REPLY_TIMEFRAME`: older comments take replies only from `judge.change_comment`. */
export const COMMENT_REPLY_WINDOW_MS = 365 * 86_400_000;
/** Legacy `DMOJ_COMMENT_VOTE_HIDE_THRESHOLD`: collapsed, still returned. */
export const COMMENT_COLLAPSE_SCORE = -5;
export const COMMENT_THREADS_PAGE_SIZE = 20;
/** New: replies listed per thread on a page, in tree order, so one crowded thread cannot make every page read huge. */
export const COMMENT_THREAD_REPLY_LIMIT = 100;
/** Stored `body` of a soft-deleted comment (the schema keeps `body` non-empty); the API sends `body: null` instead (the author's data export keeps it). */
export const COMMENT_DELETED_BODY = '[deleted]';
/** Legacy homepage `Comment.most_recent(user, 10)`. */
export const RECENT_COMMENTS_COUNT = 10;

export interface CommentPage {
  type: CommentPageType;
  id: string;
}

/** The page a comment row belongs to. */
export const pageOf = (comment: {
  page: { type: CommentPageType; id: unknown };
}): CommentPage => ({
  type: comment.page.type,
  id: uuidStr(comment.page.id),
});

/** Map key of a page. */
export const pageRef = (page: CommentPage): string => `${page.type}:${page.id}`;

/** SPA routes (contract with the frontend, listed in CONTRIBUTING). */
const PAGE_PATHS: Record<CommentPageType, (key: string) => string> = {
  problem: (key) => `/problem/${key}`,
  editorial: (key) => `/problem/${key}/editorial`,
  contest: (key) => `/contest/${key}`,
  blog: (key) => `/post/${key}`,
  tagProblem: (key) => `/tagproblem/${key}`,
};
export const pagePath = (type: CommentPageType, key: string): string =>
  PAGE_PATHS[type](encodeURIComponent(key));
export const commentLink = (
  type: CommentPageType,
  key: string,
  commentId: string,
): string => `${pagePath(type, key)}#comment-${commentId}`;

export const childPath = (parentPath: string | null, commentId: string) =>
  parentPath === null ? commentId : `${parentPath}/${commentId}`;
export const rootOf = (path: string): string => path.split('/')[0];
export const depthOf = (path: string): number => path.split('/').length - 1;
/** The comment at `path` and every descendant. Ids are UUIDs, so nothing needs escaping. Two branches because Mongo bounds an index scan by the literal prefix of a regex only when it has no alternation. */
export const subtreeFilter = (
  path: string,
): { $or: [{ path: string }, { path: RegExp }] } => ({
  $or: [{ path }, { path: new RegExp(`^${path}/`) }],
});

export const canReplyAfter = (
  parentCreatedAt: Date,
  now: Date,
  moderates: boolean,
): boolean =>
  moderates ||
  now.getTime() - parentCreatedAt.getTime() < COMMENT_REPLY_WINDOW_MS;

export const isCollapsed = (score: number): boolean =>
  score <= COMMENT_COLLAPSE_SCORE;
