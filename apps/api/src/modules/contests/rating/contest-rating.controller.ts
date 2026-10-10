import { ApiTags } from '@nestjs/swagger';
import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestRatingService } from './contest-rating.service';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';

@ApiTags('Contest editing')
@Controller('api/internal/contests')
export class ContestRatingController {
  constructor(private readonly ratings: ContestRatingService) {}

  /**
   * Rate a contest
   *
   * @remarks
   * Requires `judge.contest_rating` and edit rights on the contest. Queues
   * rating of an ended contest, which gives ratings to its participants; a
   * contest that is no longer rated loses its ratings and the later contests
   * are re-rated. Returns 202. Fails with 409 `conflict` if the contest has
   * not ended or its ranking is still frozen.
   */
  @Post(':key/rate')
  @HttpCode(202)
  rate(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.ratings.rate(auth.principal, key);
  }
}
