import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { SubmissionListQueryDto } from '../../submissions/core/dto/submission-list.dto';
import { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import { OrganizationSubmissionsService } from './organization-submissions.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationSubmissionsController {
  constructor(private readonly submissions: OrganizationSubmissionsService) {}

  /**
   * List the submissions of an organization's members
   *
   * @remarks
   * Members, administrators and holders of `judge.view_all_submission` only
   * (403 `forbidden`). Returns the members' submissions newest first, with
   * the filters and visibility rules of the site's submission list: only
   * problems the viewer may see, and other users' submissions of a contest
   * whose list is closed to the viewer are left out.
   */
  @ApiPaginatedResponse(SubmissionListItemResponse)
  @Get(':slug/submissions')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: SubmissionListQueryDto,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    return this.submissions.list(auth.principal, slug, query);
  }
}
