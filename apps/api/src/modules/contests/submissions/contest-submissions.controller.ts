import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { SubmissionListQueryDto } from '../../submissions/core/dto/submission-list.dto';
import { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { ContestSubmissionsService } from './contest-submissions.service';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';

@ApiTags('Contests')
@Controller('api/internal/contests')
export class ContestSubmissionsController {
  constructor(private readonly submissions: ContestSubmissionsService) {}

  /**
   * List the submissions of a contest
   *
   * @remarks
   * Returns the contest's submissions in the same shape as the global
   * submission list, with its filters and paging. Everyone's submissions are
   * listed to editors, and to other viewers who may see the full scoreboard
   * when the contest is not frozen and has either ended or has its submission
   * list enabled; otherwise only the viewer's own, and asking for another user
   * fails with 403 `forbidden`. Public for visible contests.
   */
  @Public()
  @ApiPaginatedResponse(SubmissionListItemResponse)
  @Get(':key/submissions')
  list(
    @Param() { key }: ContestKeyParamDto,
    @Query() query: SubmissionListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    return this.submissions.list(optionalPrincipal(auth), key, query);
  }
}
