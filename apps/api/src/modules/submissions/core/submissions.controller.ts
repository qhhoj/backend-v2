import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  SubmissionDetailResponse,
  SubmissionSourceResponse,
} from './dto/submission-detail.response';
import { SubmissionListQueryDto } from './dto/submission-list.dto';
import { SubmissionListItemResponse } from './dto/submission-list.response';
import { SubmissionIdParamDto } from './dto/submission-params.dto';
import { SubmissionStatsResponse } from './dto/submission-stats.response';
import { SubmissionStatsService } from './submission-stats.service';
import { SubmissionsService } from './submissions.service';

@Controller('api/internal/submissions')
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly stats: SubmissionStatsService,
  ) {}

  @Public()
  @ApiPaginatedResponse(SubmissionListItemResponse)
  @Get()
  list(
    @Query() query: SubmissionListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    return this.submissions.list(optionalPrincipal(auth), query);
  }

  /** Declared before `:id`, which would take `stats` for an id. */
  @Public()
  @Get('stats')
  statistics(): Promise<SubmissionStatsResponse> {
    return this.stats.stats();
  }

  @Get(':id')
  detail(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SubmissionDetailResponse> {
    return this.submissions.detail(auth.principal, id);
  }

  @Get(':id/source')
  source(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SubmissionSourceResponse> {
    return this.submissions.source(auth.principal, id);
  }
}
