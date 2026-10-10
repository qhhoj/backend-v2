import { hasEnoughSolves, INTERACT_MIN_PROBLEM_COUNT } from '@libs/community';
import type { Interactor } from '@libs/community';

export const POST_BLOCK_REASONS = [
  'signed_out',
  'contest',
  'locked',
  'muted',
  'needs_solved',
] as const;
export type PostBlockReason = (typeof POST_BLOCK_REASONS)[number];

/** Why the viewer cannot post on a page; `solved`/`required` only for `needs_solved`. */
export interface PostBlock {
  reason: PostBlockReason;
  solved: number | null;
  required: number | null;
}

/** The page's lock as it applies to the viewer: `contest` for a problem of their running contest, `locked` for a moderator's lock, null when neither applies or they hold `override_comment_lock`. */
export type PageLock = 'contest' | 'locked' | null;

const block = (reason: PostBlockReason): PostBlock => ({
  reason,
  solved: null,
  required: null,
});

/** The one posting rule (legacy `CommentForm.clean` plus the locks): checked in this order by `POST pages/:type/:key` and reported by the page listing. Null: the viewer may post. */
export const postBlockOf = (
  viewer: Interactor | null,
  lock: PageLock,
): PostBlock | null => {
  if (viewer === null) return block('signed_out');
  if (lock !== null) return block(lock);
  if (viewer.mute) return block('muted');
  if (!hasEnoughSolves(viewer))
    return {
      reason: 'needs_solved',
      solved: viewer.problemCount,
      required: INTERACT_MIN_PROBLEM_COUNT,
    };
  return null;
};
