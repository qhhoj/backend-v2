import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import {
  canInteract,
  COMMENT_THREADS_PAGE_SIZE,
  officialModeLocks,
  pageOf,
  pageRef,
} from '@libs/community';
import type { CommentPageType, VoteScore } from '@libs/community';
import { SettingsService } from '@libs/settings';
import { uuidStr } from '@libs/database';
import type { Comment } from '@libs/database';
import { VotesRepository } from '../../contributions/votes.repository';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { moderatesComments } from './comment-moderators';
import { CommentLocksRepository } from './comment-locks.repository';
import { CommentPagesService } from './comment-pages.service';
import type { PageInfo } from './comment-pages.service';
import { CommentsRepository } from './comments.repository';
import type { CommentDocument } from './comments.repository';
import {
  CommentDetailResponse,
  CommentPageLinkResponse,
  CommentPageResponse,
  CommentResponse,
} from './dto/comment.response';

@Injectable()
export class CommentsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly comments: CommentsRepository,
    private readonly locks: CommentLocksRepository,
    private readonly pages: CommentPagesService,
    private readonly votes: VotesRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Legacy `CommentedDetailView.get_context_data`, one page of threads at a time. */
  async page(
    principal: Principal | null,
    type: CommentPageType,
    key: string,
    pageNumber: number,
  ): Promise<CommentPageResponse> {
    this.assertOpen(principal);
    const pageInfo = await this.pages.resolve(principal, type, key);
    const { roots, total } = this.hidesThread(principal, pageInfo)
      ? { roots: [], total: 0 }
      : await this.comments.threads(
          pageInfo.page,
          pageNumber,
          COMMENT_THREADS_PAGE_SIZE,
        );
    const replies = await this.comments.replies(
      roots.map((root) => uuidStr(root._id)),
    );
    const ordered = roots.flatMap((root) => [
      root,
      ...replies.filter(
        (reply) => uuidStr(reply.threadId) === uuidStr(root._id),
      ),
    ]);
    const locked = await this.isLocked(principal, pageInfo);
    const viewer = principal && (await this.users.findById(principal.userId));
    return {
      page: CommentPageLinkResponse.from(pageInfo),
      locked,
      canComment: !locked && viewer !== null && canInteract(viewer),
      comments: await this.respond(principal, ordered),
      pagination: {
        page: pageNumber,
        pageSize: COMMENT_THREADS_PAGE_SIZE,
        total,
      },
    };
  }

  /** Legacy `CommentContent`: one comment with its page link. */
  async detail(
    principal: Principal | null,
    id: string,
  ): Promise<CommentDetailResponse> {
    this.assertOpen(principal);
    const { comment, pageInfo } = await this.visibleComment(principal, id, {
      allowHidden: true,
    });
    const [response] = await this.respond(principal, [comment]);
    return {
      ...response,
      page: CommentPageLinkResponse.from(pageInfo),
      hidden: comment.hidden,
    };
  }

  /** 404 for malformed, unknown and unreadable comments; hidden ones only for `change_comment` when `allowHidden`. */
  async visibleComment(
    principal: Principal | null,
    id: string,
    { allowHidden }: { allowHidden: boolean },
  ): Promise<{ comment: CommentDocument; pageInfo: PageInfo }> {
    const comment = await this.comments.findById(id);
    const moderates = moderatesComments(principal);
    const page = comment && pageOf(comment);
    const pageInfo =
      comment &&
      page &&
      (!comment.hidden || (allowHidden && moderates)) &&
      (await this.pages.accessible(principal, [page])).get(pageRef(page));
    if (!comment || !pageInfo || this.hidesThread(principal, pageInfo))
      throw new AppError('not_found', 404, 'No such comment');
    return { comment, pageInfo };
  }

  /** Authors in one read, the viewer's votes in one indexed read. */
  async respond(
    principal: Principal | null,
    comments: readonly Comment[],
  ): Promise<CommentResponse[]> {
    const ids = comments.map((comment) => uuidStr(comment._id));
    const [authors, viewerVotes] = await Promise.all([
      this.users.findByIds(
        unique(comments.map((comment) => uuidStr(comment.author))),
      ),
      principal
        ? this.votes.viewerVotes('comment', ids, principal.userId)
        : Promise.resolve(new Map<string, VoteScore>()),
    ]);
    const authorOf = new Map(
      authors.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
    const moderates = moderatesComments(principal);
    return comments.map((comment) => {
      const authorId = uuidStr(comment.author);
      return CommentResponse.from(
        comment,
        authorOf.get(authorId) ?? null,
        viewerVotes.get(uuidStr(comment._id)) ?? 0,
        moderates || principal?.userId === authorId,
      );
    });
  }

  /** Legacy hid the comment area in official contest mode; superusers keep it. */
  assertOpen(principal: Principal | null): void {
    if (officialModeLocks(this.settings, principal))
      throw new AppError(
        'forbidden',
        403,
        'Comments are closed during the official contest',
      );
  }

  /** A contest problem's thread is hidden from its contestants (legacy showed the clarifications area instead), unless they hold `override_comment_lock`. A plain lock keeps the thread readable. */
  hidesThread(principal: Principal | null, pageInfo: PageInfo): boolean {
    return pageInfo.contestLocked && !this.overridesLock(principal);
  }

  private overridesLock(principal: Principal | null): boolean {
    return (
      principal !== null &&
      hasPermission(principal, 'judge.override_comment_lock')
    );
  }

  /** Legacy `is_comment_locked` plus the contest lock; `override_comment_lock` passes both. */
  async isLocked(
    principal: Principal | null,
    pageInfo: PageInfo,
  ): Promise<boolean> {
    if (this.overridesLock(principal)) return false;
    return pageInfo.contestLocked || (await this.locks.isLocked(pageInfo.page));
  }
}
