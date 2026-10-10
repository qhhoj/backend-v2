import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Put } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { VoteDto } from '../../contributions/dto/vote.dto';
import type { VoteResponse } from '../../contributions/dto/vote.response';
import { PostIdParamDto } from '../core/dto/post-params.dto';
import { BlogVotesService } from './blog-votes.service';

@ApiTags('Blog')
@Controller('api/internal/posts/:id/vote')
export class BlogVotesController {
  constructor(private readonly votes: BlogVotesService) {}

  /**
   * Vote on a blog post
   *
   * @remarks
   * Sets the caller's vote on a post they can see: `score` is 1, -1, or 0 to
   * withdraw, and a new vote replaces the old one. Returns the new total and
   * the caller's vote. Authors cannot vote on their own post (403
   * `forbidden`), and voters need enough solved problems and an unmuted
   * account. Limited to 60 votes per minute per user across posts and
   * comments. Votes change the author's contribution points.
   */
  @Put()
  vote(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: PostIdParamDto,
    @Body() { score }: VoteDto,
  ): Promise<VoteResponse> {
    return this.votes.vote(auth.principal, id, score);
  }
}
