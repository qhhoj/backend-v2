import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService, unique } from '@libs/common';
import {
  canReplyAfter,
  childPath,
  COMMENT_MAX_DEPTH,
  commentLink,
  depthOf,
  excerpt,
  INTERACT_MIN_PROBLEM_COUNT,
  rootOf,
} from '@libs/community';
import type { CommentPageType } from '@libs/community';
import { newId, uuidStr } from '@libs/database';
import { DiscordWebhooksService } from '../../discord/discord-webhooks.service';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { ContributionPointsService } from '../../contributions/contribution-points.service';
import { renderCommentBody } from '../core/comment-markup';
import { moderatesComments } from '../core/comment-moderators';
import { CommentPagesService } from '../core/comment-pages.service';
import type { PageInfo } from '../core/comment-pages.service';
import { CommentsRepository } from '../core/comments.repository';
import type { CommentDocument } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import type { CommentResponse } from '../core/dto/comment.response';
import {
  COMMENT_LIMIT,
  COMMENT_WINDOW_SECONDS,
  PREVIEW_LIMIT,
  PREVIEW_WINDOW_SECONDS,
} from '../core/rate-limits';
import type { PostBlock } from '../core/post-block';
import type { CommentRevisionResponse } from './dto/comment-revision.response';
import type { NewCommentDto } from './dto/comment-body.dto';

const forbidden = (message: string) => new AppError('forbidden', 403, message);

/** The error of a `PostBlock`; `signed_out` here means the account vanished after the session check. */
const refusalOf = ({ reason }: PostBlock): AppError => {
  if (reason === 'signed_out')
    return new AppError('unauthorized', 401, 'Login required');
  if (reason === 'contest' || reason === 'locked')
    return forbidden('Comments on this page are locked');
  return forbidden(
    `Solve at least ${INTERACT_MIN_PROBLEM_COUNT} problems and stay unmuted to comment`,
  );
};

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

@Injectable()
export class CommentPostingService {
  constructor(
    private readonly comments: CommentsRepository,
    private readonly reads: CommentsService,
    private readonly pages: CommentPagesService,
    private readonly users: UsersRepository,
    private readonly rateLimits: RateLimitService,
    private readonly revisions: RevisionsRepository,
    private readonly discord: DiscordWebhooksService,
    private readonly contributions: ContributionPointsService,
  ) {}

  /** Legacy `CommentedDetailView.post` and `CommentForm.clean`. */
  async create(
    principal: Principal,
    { type, key }: { type: CommentPageType; key: string },
    dto: NewCommentDto,
    now = new Date(),
  ): Promise<CommentResponse> {
    this.reads.assertOpen(principal);
    const pageInfo = await this.pages.resolve(principal, type, key);
    const block = await this.reads.postBlockOn(principal, pageInfo);
    if (block) throw refusalOf(block);
    const parent = dto.parentId
      ? await this.parentOf(principal, pageInfo, dto.parentId, now)
      : null;
    const releaseHit = await this.rateLimits.reserve(
      [`comment:${principal.userId}`],
      COMMENT_LIMIT,
      COMMENT_WINDOW_SECONDS,
    );
    let comment: CommentDocument;
    try {
      const commentId = newId();
      const path = childPath(parent ? parent.path : null, commentId);
      comment = await this.comments.create({
        _id: commentId,
        page: pageInfo.page,
        author: principal.userId,
        parentId: parent ? parent._id : null,
        threadId: rootOf(path),
        path,
        body: dto.body,
        bodyHtml: renderCommentBody(dto.body),
        number: await this.comments.nextNumber(pageInfo.page),
      });
    } catch (error) {
      await releaseHit();
      throw error;
    }
    // A hide of the parent's subtree that ran meanwhile may have missed this row: follow the parent.
    const hiddenBy =
      parent && (await this.comments.hiddenBy(uuidStr(parent._id)));
    if (hiddenBy) {
      await this.comments.hideSubtree(
        comment.path,
        hiddenBy.commentId,
        hiddenBy.userId,
      );
      comment.hidden = true;
    }
    if (pageInfo.isPublic && !comment.hidden)
      await this.announce(principal, pageInfo, comment);
    const [response] = await this.reads.respond(principal, [comment]);
    return response;
  }

  /** The HTML a body would get when posted (same renderer, same length rule); for anyone who may interact. 30 a minute per user. */
  async preview(principal: Principal, body: string): Promise<string> {
    this.reads.assertOpen(principal);
    const block = await this.reads.postBlock(principal, null);
    if (block) throw refusalOf(block);
    await this.rateLimits.reserve(
      [`comment-preview:${principal.userId}`],
      PREVIEW_LIMIT,
      PREVIEW_WINDOW_SECONDS,
    );
    return renderCommentBody(body);
  }

  /** Legacy `CommentEditAjax`: the author (not muted; hidden comments are 404 to them) or `change_comment`; deleted comments are 404. */
  async edit(
    principal: Principal,
    id: string,
    body: string,
  ): Promise<CommentResponse> {
    this.reads.assertOpen(principal);
    const { comment } = await this.reads.visibleComment(principal, id, {
      allowHidden: true,
      allowDeleted: false,
    });
    if (!moderatesComments(principal)) {
      if (uuidStr(comment.author) !== principal.userId)
        throw forbidden('You can only edit your own comments');
      if ((await this.users.signedIn(principal)).mute)
        throw forbidden('Muted users cannot edit comments');
    }
    const bodyHtml = renderCommentBody(body);
    await this.comments.inTransaction(async (session) => {
      if (
        !(await this.comments.updateBodyIfRevision(
          id,
          comment.revisions,
          { body, bodyHtml },
          session,
        ))
      )
        throw new AppError(
          'conflict',
          409,
          'The comment changed meanwhile; reload it',
        );
      await this.revisions.append(
        {
          entity: 'comment',
          entityId: id,
          action: 'edit',
          userId: principal.userId,
          changes: { body: { before: comment.body, after: body } },
          comment: 'Edited from site',
        },
        session,
      );
    });
    const [response] = await this.reads.respond(principal, [
      (await this.comments.findById(id))!,
    ]);
    return response;
  }

  /** Soft delete (new; legacy had none): its author (muted too) or `change_comment`. The row stays as a placeholder so replies keep their context; votes stay but no longer count towards the author's contribution. A `delete` revision keeps the old text for moderators. */
  async remove(
    principal: Principal,
    id: string,
    now = new Date(),
  ): Promise<CommentResponse> {
    this.reads.assertOpen(principal);
    const { comment } = await this.reads.visibleComment(principal, id, {
      allowHidden: true,
      allowDeleted: false,
    });
    const authorId = uuidStr(comment.author);
    if (!moderatesComments(principal) && authorId !== principal.userId)
      throw forbidden('You can only delete your own comments');
    if (!(await this.comments.softDelete(id, principal.userId, now)))
      throw new AppError('not_found', 404, 'No such comment');
    await this.revisions.append({
      entity: 'comment',
      entityId: id,
      action: 'delete',
      userId: principal.userId,
      changes: { body: { before: comment.body, after: null } },
      comment: 'Deleted from site',
    });
    await this.contributions.refresh([authorId]);
    const [response] = await this.reads.respond(principal, [
      (await this.comments.findById(id))!,
    ]);
    return response;
  }

  /** Legacy `CommentRevisionAjax`: page access, hidden comments for `change_comment` only, and deleted ones too (their history holds the deleted text). Only `edit` rows: hides and deletes are audit, not history. */
  async revisionsOf(
    principal: Principal | null,
    id: string,
  ): Promise<CommentRevisionResponse[]> {
    this.reads.assertOpen(principal);
    const { comment } = await this.reads.visibleComment(principal, id, {
      allowHidden: true,
    });
    if (comment.deletedAt && !moderatesComments(principal))
      throw new AppError('not_found', 404, 'No such comment');
    const rows = (await this.revisions.list('comment', id)).filter(
      (row) => row.action === 'edit',
    );
    const editors = new Map(
      (
        await this.users.findByIds(
          unique(
            rows.flatMap((row) => (row.userId ? [uuidStr(row.userId)] : [])),
          ),
        )
      ).map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
    return rows.map((row) => ({
      at: row.createdAt,
      editor: row.userId ? (editors.get(uuidStr(row.userId)) ?? null) : null,
      before: text(row.changes.body?.before),
      after: text(row.changes.body?.after),
    }));
  }

  /** Same page, visible and not deleted, at most 365 days old unless `change_comment`, and not past the depth cap. */
  private async parentOf(
    principal: Principal,
    pageInfo: PageInfo,
    parentId: string,
    now: Date,
  ): Promise<CommentDocument> {
    const parent = await this.comments.findById(parentId);
    if (
      !parent ||
      parent.hidden ||
      parent.deletedAt ||
      parent.page.type !== pageInfo.page.type ||
      uuidStr(parent.page.id) !== pageInfo.page.id
    )
      throw new AppError('not_found', 404, 'No such parent comment');
    if (!canReplyAfter(parent.createdAt, now, moderatesComments(principal)))
      throw forbidden('This comment is too old to reply to');
    if (depthOf(parent.path) >= COMMENT_MAX_DEPTH)
      throw new AppError('validation_failed', 400, 'Replies nest too deep', {
        parentId: [`Replies nest at most ${COMMENT_MAX_DEPTH} levels.`],
      });
    return parent;
  }

  /** Legacy `on_new_comment`, only for pages everyone can read (legacy sent every page). */
  private announce(
    principal: Principal,
    pageInfo: PageInfo,
    comment: CommentDocument,
  ): Promise<void> {
    return this.discord.notify('on_new_comment', {
      title: `New comment ${this.discord.link(commentLink(pageInfo.page.type, pageInfo.key, uuidStr(comment._id)))}`,
      description: excerpt(comment.body, 200),
      author: this.discord.author(principal.username),
    });
  }
}
