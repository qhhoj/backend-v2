import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService, unique } from '@libs/common';
import {
  canInteract,
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
import { renderField } from '../../problems/editing/problem-markup';
import { CommentPagesService } from '../core/comment-pages.service';
import type { PageInfo } from '../core/comment-pages.service';
import { CommentsRepository } from '../core/comments.repository';
import type { CommentDocument } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import type { CommentResponse } from '../core/dto/comment.response';
import { COMMENT_LIMIT, COMMENT_WINDOW_SECONDS } from '../core/rate-limits';
import type { CommentRevisionResponse } from './dto/comment-revision.response';
import type { NewCommentDto } from './dto/comment-body.dto';

const forbidden = (message: string) => new AppError('forbidden', 403, message);
/** Legacy `comment` markdown = safe mode: raw HTML shown as text. */
const COMMENT_STYLE = 'user';

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
  ) {}

  /** Legacy `CommentedDetailView.post` and `CommentForm.clean`. */
  async create(
    principal: Principal,
    type: CommentPageType,
    key: string,
    dto: NewCommentDto,
    now = new Date(),
  ): Promise<CommentResponse> {
    this.reads.assertOpen(principal);
    const info = await this.pages.resolve(principal, type, key);
    if (await this.reads.isLocked(principal, info))
      throw forbidden('Comments on this page are locked');
    if (!canInteract((await this.users.findById(principal.userId))!))
      throw forbidden(
        `Solve at least ${INTERACT_MIN_PROBLEM_COUNT} problems and stay unmuted to comment`,
      );
    const parent = dto.parentId
      ? await this.parentOf(principal, info, dto.parentId, now)
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
        page: info.page,
        author: principal.userId,
        parentId: parent ? parent._id : null,
        threadId: rootOf(path),
        path,
        body: dto.body,
        bodyHtml: renderField(dto.body, COMMENT_STYLE, 'body'),
      });
    } catch (error) {
      await releaseHit();
      throw error;
    }
    // A hide of the parent's subtree that ran meanwhile may have missed this row: follow the parent.
    if (parent && (await this.comments.isHidden(uuidStr(parent._id)))) {
      await this.comments.setSubtreeHidden(comment.path, true);
      comment.hidden = true;
    }
    if (info.isPublic && !comment.hidden)
      await this.announce(principal, info, comment);
    const [response] = await this.reads.respond(principal, [comment]);
    return response;
  }

  /** Legacy `CommentEditAjax`: the author (not muted; hidden comments are 404 to them) or `change_comment`. */
  async edit(
    principal: Principal,
    id: string,
    body: string,
  ): Promise<CommentResponse> {
    this.reads.assertOpen(principal);
    const { comment } = await this.reads.visibleComment(principal, id, {
      allowHidden: true,
    });
    if (!hasPermission(principal, 'judge.change_comment')) {
      if (uuidStr(comment.author) !== principal.userId)
        throw forbidden('You can only edit your own comments');
      if ((await this.users.findById(principal.userId))!.mute)
        throw forbidden('Muted users cannot edit comments');
    }
    const bodyHtml = renderField(body, COMMENT_STYLE, 'body');
    await this.comments.inTransaction(async (session) => {
      if (
        !(await this.comments.updateBodyIfRevision(
          id,
          comment.revisions,
          body,
          bodyHtml,
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

  /** Legacy `CommentRevisionAjax`: page access, hidden comments for `change_comment` only. */
  async revisionsOf(
    principal: Principal | null,
    id: string,
  ): Promise<CommentRevisionResponse[]> {
    this.reads.assertOpen(principal);
    await this.reads.visibleComment(principal, id, { allowHidden: true });
    const rows = await this.revisions.list('comment', id);
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

  /** Same page, visible, at most 365 days old unless `change_comment`, and not past the depth cap. */
  private async parentOf(
    principal: Principal,
    info: PageInfo,
    parentId: string,
    now: Date,
  ): Promise<CommentDocument> {
    const parent = await this.comments.findById(parentId);
    if (
      !parent ||
      parent.hidden ||
      parent.page.type !== info.page.type ||
      uuidStr(parent.page.id) !== info.page.id
    )
      throw new AppError('not_found', 404, 'No such parent comment');
    if (
      !canReplyAfter(
        parent.createdAt,
        now,
        hasPermission(principal, 'judge.change_comment'),
      )
    )
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
    info: PageInfo,
    comment: CommentDocument,
  ): Promise<void> {
    return this.discord.notify('on_new_comment', {
      title: `New comment ${this.discord.link(commentLink(info.page.type, info.key, uuidStr(comment._id)))}`,
      description: excerpt(comment.body, 200),
      author: this.discord.author(principal.username),
    });
  }
}
