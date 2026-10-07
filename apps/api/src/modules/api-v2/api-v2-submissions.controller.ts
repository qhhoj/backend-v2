import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { SubmissionIdParamDto } from '../submissions/core/dto/submission-params.dto';
import { ApiV2ExceptionFilter } from './api-v2-exception.filter';
import { ApiV2Query, lenientQueryPipe } from './api-v2-query';
import { ApiV2SubmissionsService } from './api-v2-submissions.service';
import { ApiV2SubmissionListDto } from './dto/api-v2-submission-list.dto';
import { legacyEnvelope } from './legacy-envelope';

@RawResponse()
@UseFilters(ApiV2ExceptionFilter)
@Controller('api/v2')
export class ApiV2SubmissionsController {
  constructor(private readonly submissions: ApiV2SubmissionsService) {}

  @Public()
  @Get('submissions')
  async list(
    @ApiV2Query(lenientQueryPipe) query: ApiV2SubmissionListDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope(
      'get',
      await this.submissions.list(optionalPrincipal(auth), query),
    );
  }

  /** Legacy `APILoginRequiredMixin`: the guard's 401 becomes 403 `login required` in the filter. */
  @Get('submission/:id')
  async detail(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return legacyEnvelope('get', {
      object: await this.submissions.detail(auth.principal, id),
    });
  }
}
