import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { SubmissionListQueryDto } from '../../submissions/core/dto/submission-list.dto';
import { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { ContestSubmissionsService } from './contest-submissions.service';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';

@Controller('api/internal/contests')
export class ContestSubmissionsController {
  constructor(private readonly submissions: ContestSubmissionsService) {}

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
