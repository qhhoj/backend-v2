import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import type { VoteScore } from '@libs/community';
import type { VoteResponse } from '../../contributions/dto/vote.response';
import { VotesService } from '../../contributions/votes.service';
import { BlogVisibilityService } from '../core/blog-visibility.service';

/** Legacy `vote_blog`, only on posts the voter can see (legacy checked nothing). */
@Injectable()
export class BlogVotesService {
  constructor(
    private readonly visibility: BlogVisibilityService,
    private readonly votes: VotesService,
  ) {}

  async vote(
    principal: Principal,
    id: string,
    score: VoteScore,
  ): Promise<VoteResponse> {
    const { view } = await this.visibility.visiblePost(principal, id);
    return this.votes.cast(
      principal,
      { target: 'blog', targetId: view.id, ownerIds: view.authors },
      score,
    );
  }
}
