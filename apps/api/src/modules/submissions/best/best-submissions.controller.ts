import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ProblemCodeParamDto } from '../../problems/core/dto/problem-params.dto';
import { SubmissionListItemResponse } from '../core/dto/submission-list.response';
import { BestSubmissionsService } from './best-submissions.service';
import { BestSubmissionsQueryDto } from './dto/best-submissions.dto';

@ApiTags('Submissions')
@Controller('api/internal/problems')
export class BestSubmissionsController {
  constructor(private readonly best: BestSubmissionsService) {}

  /**
   * List the best submission of each user on a problem
   *
   * @remarks
   * Public. One row per user: their judged submission with the most points,
   * ties broken by less time, then less memory, then the earlier submission.
   * Rows are ordered the same way (`page` from 1, `pageSize` 1-100, default
   * 50); submissions without points, unlisted and banned users are left out.
   * Visibility follows the submission list: other users' submissions of a
   * contest whose list is closed to the viewer are left out. Unknown or
   * invisible problems are 404 `not_found`.
   */
  @Public()
  @ApiPaginatedResponse(SubmissionListItemResponse)
  @Get(':code/best-submissions')
  list(
    @Param() { code }: ProblemCodeParamDto,
    @Query() query: BestSubmissionsQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    return this.best.list(optionalPrincipal(auth), code, query);
  }
}
