import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import type { CommentPageType } from '@libs/community';
import { uuidStr } from '@libs/database';
import { ContributionPointsService } from '../../contributions/contribution-points.service';
import { VotesRepository } from '../../contributions/votes.repository';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { CommentLocksRepository } from '../core/comment-locks.repository';
import { CommentPagesService } from '../core/comment-pages.service';
import { CommentsRepository } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import type { CommentDetailResponse } from '../core/dto/comment.response';
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
  ) {}

  /** Legacy `comment_hide` (and the admin `unhide_comment`), on the subtree (unhide restores only what that comment hid); the authors' points are recomputed. A comment under a hidden parent cannot be unhidden alone. */
  async setHidden(
    principal: Principal,
    id: string,
    hidden: boolean,
  ): Promise<CommentDetailResponse> {
    this.comments.assertOpen(principal);
    const { comment } = await this.comments.visibleComment(principal, id, {
      allowHidden: true,
    });
    if (
      !hidden &&
      comment.parentId &&
      (await this.repository.hiddenBy(comment.parentId))
    )
      throw new AppError('conflict', 409, 'Unhide its parent first');
    const authors = await (hidden
      ? this.repository.hideSubtree(comment.path, uuidStr(comment._id))
      : this.repository.unhideSubtree(comment.path, uuidStr(comment._id)));
    await this.contributions.refresh(authors);
    return this.comments.detail(principal, id);
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
    locked: boolean,
  ): Promise<void> {
    this.comments.assertOpen(principal);
    const { page } = await this.pages.resolve(principal, type, key);
    await (locked ? this.locks.lock(page) : this.locks.unlock(page));
  }
}
