import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import type { CommentPageType } from '@libs/community';
import { uuidStr } from '@libs/database';
import { ContributionPointsService } from '../../contributions/contribution-points.service';
import { VotesRepository } from '../../contributions/votes.repository';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { CommentLocksRepository } from '../core/comment-locks.repository';
import { CommentPagesService } from '../core/comment-pages.service';
import { CommentsRepository } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import type { CommentDetailResponse } from '../core/dto/comment.response';
import type { BulkHideOutcomeResponse } from './dto/bulk-hide-comments.dto';
import type { CommentVoteEntryResponse } from './dto/comment-vote-entry.response';

/** `judge.change_comment` tools; every route still needs page access (404 otherwise) and is closed in official contest mode. */
@Injectable()
export class CommentModerationService {
  constructor(
    private readonly comments: CommentsService,
    private readonly repository: CommentsRepository,
    private readonly pages: CommentPagesService,
    private readonly locks: CommentLocksRepository,
    private readonly votes: VotesRepository,
    private readonly users: UsersRepository,
    private readonly contributions: ContributionPointsService,
    private readonly revisions: RevisionsRepository,
  ) {}

  /** Legacy `comment_hide` (and the admin `unhide_comment`), on the subtree (unhide restores only what that comment hid); the authors' points are recomputed and a `hide`/`unhide` revision records the moderator. A comment under a hidden parent cannot be unhidden alone. */
  async setHidden(
    principal: Principal,
    id: string,
    isHidden: boolean,
  ): Promise<CommentDetailResponse> {
    this.comments.assertOpen(principal);
    await this.contributions.refresh(
      await this.applyHidden(principal, id, isHidden),
    );
    return this.comments.detail(principal, id);
  }

  /** `setHidden` on many comments: each id gets its own outcome (a refused one does not stop the rest), a comment already in that state is left alone, and one refused because its parent was still hidden is tried again after the others. The points are recomputed once, also when a write fails midway. */
  async setHiddenMany(
    principal: Principal,
    ids: string[],
    isHidden: boolean,
  ): Promise<BulkHideOutcomeResponse[]> {
    this.comments.assertOpen(principal);
    const authors: string[] = [];
    const codes = new Map<string, string | null>();
    const attempt = async (id: string) => {
      try {
        authors.push(
          ...(await this.applyHidden(principal, id, isHidden, true)),
        );
        codes.set(id, null);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        codes.set(id, error.code);
      }
    };
    try {
      for (const id of unique(ids)) await attempt(id);
      for (const [id, code] of codes)
        if (code === 'conflict') await attempt(id);
    } finally {
      await this.contributions.refresh(unique(authors));
    }
    return [...codes].map(([id, code]) => ({ id, code }));
  }

  /** Hides or unhides one subtree and records the revision; returns the authors whose points changed. `skipUnchanged`: a comment already in that state is a no-op (no revision). */
  private async applyHidden(
    principal: Principal,
    id: string,
    isHidden: boolean,
    skipUnchanged = false,
  ): Promise<string[]> {
    const { comment } = await this.comments.visibleComment(principal, id, {
      allowHidden: true,
    });
    if (skipUnchanged && comment.hidden === isHidden) return [];
    if (
      !isHidden &&
      comment.parentId &&
      (await this.repository.hiddenBy(comment.parentId))
    )
      throw new AppError('conflict', 409, 'Unhide its parent first');
    const authors = await (isHidden
      ? this.repository.hideSubtree(
          comment.path,
          uuidStr(comment._id),
          principal.userId,
        )
      : this.repository.unhideSubtree(comment.path, uuidStr(comment._id)));
    await this.revisions.append({
      entity: 'comment',
      entityId: id,
      action: isHidden ? 'hide' : 'unhide',
      userId: principal.userId,
      changes: { hidden: { before: comment.hidden, after: isHidden } },
      comment: '',
    });
    return authors;
  }

  /** Legacy `CommentVotesAjax`. */
  async votesOf(
    principal: Principal,
    id: string,
  ): Promise<CommentVoteEntryResponse[]> {
    this.comments.assertOpen(principal);
    const { comment } = await this.comments.visibleComment(principal, id, {
      allowHidden: true,
    });
    const rows = await this.votes.votesOn('comment', uuidStr(comment._id));
    const voters = new Map(
      (await this.users.findByIds(rows.map((row) => row.voter))).map((user) => [
        user._id,
        UserSummaryResponse.from(user),
      ]),
    );
    return rows.map((row) => ({
      voter: voters.get(row.voter) ?? null,
      score: row.score,
    }));
  }

  async setLocked(
    principal: Principal,
    type: CommentPageType,
    key: string,
    isLocked: boolean,
  ): Promise<void> {
    this.comments.assertOpen(principal);
    const { page } = await this.pages.resolve(principal, type, key);
    await (isLocked ? this.locks.lock(page) : this.locks.unlock(page));
  }
}
