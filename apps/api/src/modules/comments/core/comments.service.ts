import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import {
  COMMENT_THREAD_REPLY_LIMIT,
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
  CommentLocationResponse,
  CommentPageLinkResponse,
  CommentPageResponse,
  CommentPostBlockResponse,
  CommentResponse,
} from './dto/comment.response';
import { postBlockOf } from './post-block';
import type { PageLock, PostBlock } from './post-block';

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

  /** Legacy `CommentedDetailView.get_context_data`, one page of threads at a time. Moderators also get the hidden comments, flagged. */
  async page(
    principal: Principal | null,
    type: CommentPageType,
    key: string,
    pageNumber: number,
  ): Promise<CommentPageResponse> {
    this.assertOpen(principal);
    const pageInfo = await this.pages.resolve(principal, type, key);
    const withHidden = moderatesComments(principal);
    const { roots, total } = this.hidesThread(principal, pageInfo)
      ? { roots: [], total: 0 }
      : await this.comments.threads(
          pageInfo.page,
          pageNumber,
          COMMENT_THREADS_PAGE_SIZE,
          withHidden,
        );
    const threads = await Promise.all(
      roots.map(async (root) => ({
        root,
        ...(await this.comments.replies(
          uuidStr(root._id),
          withHidden,
          COMMENT_THREAD_REPLY_LIMIT,
        )),
      })),
    );
    const ordered = threads.flatMap(({ root, replies }) => [root, ...replies]);
    const pageLocked = await this.locks.isLocked(pageInfo.page);
    const lock = this.lockOf(principal, pageInfo, pageLocked);
    const postBlock = await this.postBlock(principal, lock);
    return {
      page: CommentPageLinkResponse.from(pageInfo),
      locked: lock !== null,
      pageLocked,
      canComment: postBlock === null,
      postBlock: CommentPostBlockResponse.from(postBlock),
      comments: await this.respond(principal, ordered),
      truncatedThreads: threads
        .filter((thread) => thread.truncated)
        .map(({ root }) => uuidStr(root._id)),
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
    return { ...response, page: CommentPageLinkResponse.from(pageInfo) };
  }

  /** The listing page holding the comment's thread for this viewer (moderators count hidden threads too), for `#comment-<id>` links. */
  async locate(
    principal: Principal | null,
    id: string,
  ): Promise<CommentLocationResponse> {
    this.assertOpen(principal);
    const { comment, pageInfo } = await this.visibleComment(principal, id, {
      allowHidden: true,
    });
    const newer = await this.comments.rootsNewerThan(
      pageInfo.page,
      uuidStr(comment.threadId),
      moderatesComments(principal),
    );
    return {
      page: CommentPageLinkResponse.from(pageInfo),
      pageNumber: Math.floor(newer / COMMENT_THREADS_PAGE_SIZE) + 1,
    };
  }

  /** 404 for malformed, unknown and unreadable comments; hidden ones only for `change_comment` when `allowHidden`; deleted ones unless `allowDeleted` (reads show the placeholder, writes refuse it). */
  async visibleComment(
    principal: Principal | null,
    id: string,
    {
      allowHidden,
      allowDeleted = true,
    }: { allowHidden: boolean; allowDeleted?: boolean },
  ): Promise<{ comment: CommentDocument; pageInfo: PageInfo }> {
    const comment = await this.comments.findById(id);
    const moderates = moderatesComments(principal);
    const page = comment && pageOf(comment);
    const pageInfo =
      comment &&
      page &&
      (!comment.hidden || (allowHidden && moderates)) &&
      (allowDeleted || !comment.deletedAt) &&
      (await this.pages.accessible(principal, [page])).get(pageRef(page));
    if (!comment || !pageInfo || this.hidesThread(principal, pageInfo))
      throw new AppError('not_found', 404, 'No such comment');
    return { comment, pageInfo };
  }

  /** Authors and hiding moderators in one read, the viewer's votes in one indexed read. */
  async respond(
    principal: Principal | null,
    comments: readonly Comment[],
  ): Promise<CommentResponse[]> {
    const ids = comments.map((comment) => uuidStr(comment._id));
    const userIds = comments.flatMap((comment) => [
      uuidStr(comment.author),
      ...(comment.hiddenByUser ? [uuidStr(comment.hiddenByUser)] : []),
    ]);
    const [users, viewerVotes] = await Promise.all([
      this.users.findByIds(unique(userIds)),
      principal
        ? this.votes.viewerVotes('comment', ids, principal.userId)
        : Promise.resolve(new Map<string, VoteScore>()),
    ]);
    const summaryOf = new Map(
      users.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
    const moderates = moderatesComments(principal);
    return comments.map((comment) => {
      const authorId = uuidStr(comment.author);
      return CommentResponse.from(comment, {
        author: summaryOf.get(authorId) ?? null,
        hiddenBy: comment.hiddenByUser
          ? (summaryOf.get(uuidStr(comment.hiddenByUser)) ?? null)
          : null,
        viewerVote: viewerVotes.get(uuidStr(comment._id)) ?? 0,
        canEdit: moderates || principal?.userId === authorId,
      });
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

  /** Legacy `is_comment_locked` plus the contest lock, as it applies to the viewer; `override_comment_lock` passes both. */
  lockOf(
    principal: Principal | null,
    pageInfo: PageInfo,
    pageLocked: boolean,
  ): PageLock {
    if (this.overridesLock(principal)) return null;
    if (pageInfo.contestLocked) return 'contest';
    return pageLocked ? 'locked' : null;
  }

  /** Why the viewer cannot post on the page (`postBlockOf`); the listing reports it and posting refuses on it. */
  async postBlock(
    principal: Principal | null,
    lock: PageLock,
  ): Promise<PostBlock | null> {
    const viewer = principal && (await this.users.findById(principal.userId));
    return postBlockOf(viewer, lock);
  }

  /** `postBlock` for a page by its info, reading the lock. */
  async postBlockOn(
    principal: Principal | null,
    pageInfo: PageInfo,
  ): Promise<PostBlock | null> {
    const pageLocked = await this.locks.isLocked(pageInfo.page);
    return this.postBlock(
      principal,
      this.lockOf(principal, pageInfo, pageLocked),
    );
  }
}
