import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, RefuseNullFieldsPipe } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import { UpdateQuotaDto, UsageOverviewQueryDto } from './dto/usage.dto';
import {
  OrganizationUsageResponse,
  UsageOverviewRowResponse,
} from './dto/usage.response';
import { OrganizationUsageService } from './organization-usage.service';

@Controller('api/internal/organizations')
export class OrganizationUsageController {
  constructor(private readonly usage: OrganizationUsageService) {}

  /** Static `usage` wins over `:slug` (the slug `usage` is reserved). */
  @RequirePermission('judge.edit_all_organization')
  @ApiPaginatedResponse(UsageOverviewRowResponse)
  @Get('usage')
  overview(
    @Query() query: UsageOverviewQueryDto,
  ): Promise<Paginated<UsageOverviewRowResponse>> {
    return this.usage.overview(query);
  }

  @Get(':slug/usage')
  one(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<OrganizationUsageResponse> {
    return this.usage.usage(auth.principal, slug);
  }

  @RequirePermission('judge.edit_all_organization')
  @Patch(':slug/quota')
  updateQuota(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body(
      new RefuseNullFieldsPipe(['quotaMonthlyCredits', 'quotaStorageBytes']),
    )
    body: UpdateQuotaDto,
  ): Promise<OrganizationUsageResponse> {
    return this.usage.updateQuota(auth.principal, slug, body);
  }
}
