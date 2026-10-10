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
  /** The caller may edit the comment. */
  canEdit!: boolean;

  static from(
    comment: Comment,
    author: UserSummaryResponse | null,
    viewerVote: VoteScore,
    canEdit: boolean,
  ): CommentResponse {
    return {
      id: uuidStr(comment._id),
      parentId: comment.parentId === null ? null : uuidStr(comment.parentId),
      depth: depthOf(comment.path),
      author,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      bodyHtml: comment.bodyHtml,
      body: canEdit ? comment.body : null,
      score: comment.score,
      collapsed: isCollapsed(comment.score),
      revisions: comment.revisions,
      viewerVote,
      canEdit,
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

export class CommentPageResponse {
  /** The page the comments belong to. */
  page!: CommentPageLinkResponse;
  /** Locked for this viewer (a lock without `override_comment_lock`, or a problem of their running contest). */
  locked!: boolean;
  /** Signed in, past the interaction gate, and not locked. */
  canComment!: boolean;
  /** Roots newest first, each followed by its visible replies in tree order. */
  comments!: CommentResponse[];
  /** Paging of the top-level threads. */
  pagination!: CommentPaginationResponse;
}

export class CommentDetailResponse extends CommentResponse {
  /** The page the comment belongs to. */
  page!: CommentPageLinkResponse;
  /**
   * Whether the comment is hidden; only moderators can read hidden comments.
   */
  hidden!: boolean;
}
