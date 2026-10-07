import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import type { VoteScore } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { VoteResponse } from '../../contributions/dto/vote.response';
import { VotesService } from '../../contributions/votes.service';
import { CommentsService } from '../core/comments.service';

/** Legacy `vote_comment`, changeable and withdrawable; never hidden comments or unreadable pages (legacy checked neither page). */
@Injectable()
export class CommentVotesService {
  constructor(
    private readonly comments: CommentsService,
    private readonly votes: VotesService,
  ) {}

  async vote(
    principal: Principal,
    id: string,
    score: VoteScore,
  ): Promise<VoteResponse> {
    this.comments.assertOpen(principal);
    const { comment } = await this.comments.visibleComment(principal, id, {
      allowHidden: false,
    });
    return this.votes.cast(
      principal,
      {
        target: 'comment',
        targetId: uuidStr(comment._id),
        ownerIds: [uuidStr(comment.author)],
      },
      score,
    );
  }
}
