import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { canInteract, INTERACT_MIN_PROBLEM_COUNT } from '@libs/community';
import type { VoteScore } from '@libs/community';
import { ContributionPointsService } from './contribution-points.service';
import type { VoteResponse } from './dto/vote.response';
import { VOTE_LIMIT, VOTE_WINDOW_SECONDS } from './rate-limits';
import { VotesRepository } from './votes.repository';
import type { VoteTarget } from './votes.repository';

export interface VoteRequest {
  target: VoteTarget;
  targetId: string;
  /** Authors of the target: they cannot vote on it, and their contribution follows its score. */
  ownerIds: readonly string[];
}

/** Legacy `vote_blog`/`vote_comment` gates, changeable and withdrawable votes. Callers check first that the voter may see the target (404) and, for comments, that it is not hidden. */
@Injectable()
export class VotesService {
  constructor(
    private readonly users: UsersRepository,
    private readonly votes: VotesRepository,
    private readonly rateLimits: RateLimitService,
    private readonly contributions: ContributionPointsService,
  ) {}

  async cast(
    principal: Principal,
    request: VoteRequest,
    score: VoteScore,
  ): Promise<VoteResponse> {
    if (request.ownerIds.includes(principal.userId))
      throw new AppError('forbidden', 403, 'You cannot vote on your own text');
    const voter = await this.users.findById(principal.userId);
    if (!voter) throw new AppError('unauthorized', 401, 'Login required');
    if (!canInteract(voter))
      throw new AppError(
        'forbidden',
        403,
        `Solve at least ${INTERACT_MIN_PROBLEM_COUNT} problems and stay unmuted to vote`,
      );
    await this.rateLimits.reserve(
      [`vote:${principal.userId}`],
      VOTE_LIMIT,
      VOTE_WINDOW_SECONDS,
    );
    const total = await this.votes.cast(
      request.target,
      request.targetId,
      principal.userId,
      score,
    );
    await this.contributions.refresh(request.ownerIds);
    return { score: total, viewerVote: score };
  }
}
