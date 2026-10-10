import { ApiProperty } from '@nestjs/swagger';
import {
  COMMENT_PAGE_TYPES,
  depthOf,
  isCollapsed,
  VOTE_SCORES,
} from '@libs/community';
import type { CommentPageType, VoteScore } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Comment } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import type { PageInfo } from '../comment-pages.service';
import { POST_BLOCK_REASONS } from '../post-block';
import type { PostBlock, PostBlockReason } from '../post-block';

export class CommentPageLinkResponse {
  /** Kind of page. */
  @ApiProperty({ enum: COMMENT_PAGE_TYPES, enumName: 'CommentPageType' })
  type!: CommentPageType;
  /** Natural key of the page. */
  key!: string;
  /** Title of the page. */
  title!: string;

  static from(pageInfo: PageInfo): CommentPageLinkResponse {
    return {
      type: pageInfo.page.type,
      key: pageInfo.key,
      title: pageInfo.title,
    };
  }
}

export class CommentResponse {
  /** Id of the comment. */
  id!: string;
  /** Id of the comment replied to; null for a top-level comment. */
  parentId!: string | null;
  /** Nesting level; 0 for top-level comments. */
  depth!: number;
  /** Null when the author's account is gone. */
  author!: UserSummaryResponse | null;
  /** When the comment was posted, ISO 8601. */
  createdAt!: Date;
  /** When the comment was last changed, ISO 8601. */
  updatedAt!: Date;
  /** The comment rendered to HTML. */
  bodyHtml!: string;
  /** Markdown source, for the edit form: the author and moderators only (`canEdit`), else null. */
  body!: string | null;
  /** Sum of the votes. */
  score!: number;
  /** Score at or below -5: the SPA folds it (legacy collapsed client-side). */
  collapsed!: boolean;
  /** Number of edits made to the comment. */
  revisions!: number;
  /** The caller's vote: 1, -1 or 0. */
  @ApiProperty({ enum: VOTE_SCORES, enumName: 'VoteScore' })
  viewerVote!: VoteScore;
  /** The caller may edit the comment (never once deleted). */
  canEdit!: boolean;
  /** The caller may delete the comment: its author or a moderator, while not deleted. */
  canDelete!: boolean;
  /** Hidden by a moderator; hidden comments reach moderators only. */
  hidden!: boolean;
  /** The moderator who hid it; null while visible or when unknown (hidden on the old site). */
  hiddenBy!: UserSummaryResponse | null;
  /** Deleted by its author or a moderator: `bodyHtml` is empty and `body` null; the row stays as a placeholder for its replies. */
  deleted!: boolean;
  /** Stable 1-based position on its page in posting order; null until numbered. */
  number!: number | null;

  static from(
    comment: Comment,
    {
      author,
      hiddenBy,
      viewerVote,
      canEdit,
    }: {
      author: UserSummaryResponse | null;
      hiddenBy: UserSummaryResponse | null;
      viewerVote: VoteScore;
      /** Author or moderator; narrowed here for deleted comments. */
      canEdit: boolean;
    },
  ): CommentResponse {
    const deleted = Boolean(comment.deletedAt);
    const editable = canEdit && !deleted;
    return {
      id: uuidStr(comment._id),
      parentId: comment.parentId === null ? null : uuidStr(comment.parentId),
      depth: depthOf(comment.path),
      author,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      bodyHtml: deleted ? '' : comment.bodyHtml,
      body: editable ? comment.body : null,
      score: comment.score,
      collapsed: isCollapsed(comment.score),
      revisions: comment.revisions,
      viewerVote,
      canEdit: editable,
      canDelete: editable,
      hidden: comment.hidden,
      hiddenBy: comment.hidden ? hiddenBy : null,
      deleted,
      number: comment.number ?? null,
    };
  }
}

export class CommentPaginationResponse {
  /** 1-based page number of threads. */
  page!: number;
  /** Threads per page. */
  pageSize!: number;
  /** Total number of threads. */
  total!: number;
}

export class CommentPostBlockResponse {
  /** Why the viewer cannot comment: signed out, a problem of their running contest, a locked page, a muted account, or too few solved problems. */
  @ApiProperty({ enum: POST_BLOCK_REASONS, enumName: 'CommentPostBlockReason' })
  reason!: PostBlockReason;
  /** Problems the viewer solved; only for `needs_solved`. */
  solved!: number | null;
  /** Problems needed to comment; only for `needs_solved`. */
  required!: number | null;

  static from(block: PostBlock | null): CommentPostBlockResponse | null {
    return block && { ...block };
  }
}

export class CommentPageResponse {
  /** The page the comments belong to. */
  page!: CommentPageLinkResponse;
  /** Locked for this viewer (a lock without `override_comment_lock`, or a problem of their running contest). */
  locked!: boolean;
  /** The page's own lock flag, whoever views it: what moderators toggle with `PUT`/`DELETE .../lock`. */
  pageLocked!: boolean;
  /** Signed in, past the interaction gate, and not locked: `postBlock` is null. */
  canComment!: boolean;
  /** Why the viewer cannot comment, by the same rule posting enforces; null when they can. */
  postBlock!: CommentPostBlockResponse | null;
  /** Roots newest first, each followed by its replies in tree order: hidden ones only for moderators, deleted ones as placeholders. */
  comments!: CommentResponse[];
  /** Paging of the top-level threads. */
  pagination!: CommentPaginationResponse;
}

export class CommentDetailResponse extends CommentResponse {
  /** The page the comment belongs to. */
  page!: CommentPageLinkResponse;
}

export class CommentLocationResponse {
  /** The page the comment belongs to. */
  page!: CommentPageLinkResponse;
  /** The 1-based listing page (`?page=`) that holds the comment's thread, for this viewer. */
  pageNumber!: number;
}
