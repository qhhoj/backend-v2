import { Body, Controller, Param, Put } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { VoteDto } from '../../contributions/dto/vote.dto';
import type { VoteResponse } from '../../contributions/dto/vote.response';
import { PostIdParamDto } from '../core/dto/post-params.dto';
import { BlogVotesService } from './blog-votes.service';

@Controller('api/internal/posts/:id/vote')
export class BlogVotesController {
  constructor(private readonly votes: BlogVotesService) {}

  @Put()
  vote(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: PostIdParamDto,
    @Body() { score }: VoteDto,
  ): Promise<VoteResponse> {
    return this.votes.vote(auth.principal, id, score);
  }
}
