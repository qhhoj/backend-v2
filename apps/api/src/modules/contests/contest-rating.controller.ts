import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestRatingService } from './contest-rating.service';
import { ContestKeyParamDto } from './dto/contest-params.dto';
import { QueuedResponse } from './dto/queued.response';

@Controller('api/internal/contests')
export class ContestRatingController {
  constructor(private readonly ratings: ContestRatingService) {}

  @Post(':key/rate')
  @HttpCode(202)
  rate(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.ratings.rate(auth.principal, key);
  }
}
