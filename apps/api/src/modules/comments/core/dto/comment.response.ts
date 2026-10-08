import { depthOf, isCollapsed } from '@libs/community';
import type { CommentPageType, VoteScore } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Comment } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import type { PageInfo } from '../comment-pages.service';

export class CommentPageLinkResponse {
  type!: CommentPageType;
  key!: string;
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
  id!: string;
  parentId!: string | null;
  depth!: number;
  /** Null when the author's account is gone. */
  author!: UserSummaryResponse | null;
  createdAt!: Date;
  updatedAt!: Date;
  bodyHtml!: string;
  /** Markdown source, for the edit form: the author and moderators only (`canEdit`), else null. */
  body!: string | null;
  score!: number;
  /** Score at or below -5: the SPA folds it (legacy collapsed client-side). */
  collapsed!: boolean;
  revisions!: number;
  viewerVote!: VoteScore;
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
  page!: number;
  pageSize!: number;
  total!: number;
}

export class CommentPageResponse {
  page!: CommentPageLinkResponse;
  /** Locked for this viewer (a lock without `override_comment_lock`, or a problem of their running contest). */
  locked!: boolean;
  /** Signed in, past the interaction gate, and not locked. */
  canComment!: boolean;
  /** Roots newest first, each followed by its visible replies in tree order. */
  comments!: CommentResponse[];
  pagination!: CommentPaginationResponse;
}

export class CommentDetailResponse extends CommentResponse {
  page!: CommentPageLinkResponse;
  hidden!: boolean;
}
