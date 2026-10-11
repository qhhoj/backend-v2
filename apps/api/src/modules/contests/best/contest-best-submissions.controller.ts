import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { BestSubmissionsQueryDto } from '../../submissions/best/dto/best-submissions.dto';
import { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { ContestProblemParamsDto } from '../core/dto/contest-params.dto';
import { ContestBestSubmissionsService } from './contest-best-submissions.service';

@ApiTags('Contests')
@Controller('api/internal/contests')
export class ContestBestSubmissionsController {
  constructor(private readonly best: ContestBestSubmissionsService) {}

  /**
   * List the best submission of each user on a contest problem
   *
   * @remarks
   * Public for visible contests. Same rows and order as the problem's best
   * submissions (most points, then less time, less memory, the earlier
   * submission; `page` from 1, `pageSize` 1-100, default 50), but only
   * submissions made in the contest. Everyone's rows go to editors and to
   * viewers the contest submission list is open to; other viewers get only
   * their own. While the ranking is frozen for the viewer, submissions made at
   * or after the freeze are left out. 403
   * `forbidden` unless the viewer may see the full ranking and the problem
   * list; 404 `not_found` for a problem the contest does not have.
   */
  @Public()
  @ApiPaginatedResponse(SubmissionListItemResponse)
  @Get(':key/problems/:code/best-submissions')
  list(
    @Param() { key, code }: ContestProblemParamsDto,
    @Query() query: BestSubmissionsQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    return this.best.list(optionalPrincipal(auth), { key, code }, query);
  }
}
