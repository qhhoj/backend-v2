import { Body, Controller, Param, Put } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { VoteDto } from '../../contributions/dto/vote.dto';
import type { VoteResponse } from '../../contributions/dto/vote.response';
import { CommentIdParamDto } from '../core/dto/comment-params.dto';
import { CommentVotesService } from './comment-votes.service';

@Controller('api/internal/comments/:id/vote')
export class CommentVotesController {
  constructor(private readonly votes: CommentVotesService) {}

  @Put()
  vote(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body() { score }: VoteDto,
  ): Promise<VoteResponse> {
    return this.votes.vote(auth.principal, id, score);
  }
}
