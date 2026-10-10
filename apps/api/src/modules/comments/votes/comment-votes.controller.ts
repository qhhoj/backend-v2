import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Put } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { VoteDto } from '../../contributions/dto/vote.dto';
import type { VoteResponse } from '../../contributions/dto/vote.response';
import { CommentIdParamDto } from '../core/dto/comment-params.dto';
import { CommentVotesService } from './comment-votes.service';

@ApiTags('Comments')
@Controller('api/internal/comments/:id/vote')
export class CommentVotesController {
  constructor(private readonly votes: CommentVotesService) {}

  /**
   * Vote on a comment
   *
   * @remarks
   * Sets the caller's vote on a visible comment that is not hidden or deleted: `score` is 1, -1,
   * or 0 to withdraw. Returns the new total and the caller's vote. Authors
   * cannot vote on their own comment (403 `forbidden`); voters need enough
   * solved problems and an unmuted account. Limited to 60 votes per minute per
   * user.
   */
  @Put()
  vote(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body() { score }: VoteDto,
  ): Promise<VoteResponse> {
    return this.votes.vote(auth.principal, id, score);
  }
}
