import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationUsageController {
  constructor(private readonly usage: OrganizationUsageService) {}

  /**
   * List quota usage of all organizations
   *
   * @remarks
   * Requires `judge.edit_all_organization`. Returns one row per organization
   * for the current month: credits used and their limit, storage used and its
   * limit, and whether it is unlimited. Sort by `name` (default) or `credits`;
   * paged with `page` and `pageSize`.
   */
  @RequirePermission('judge.edit_all_organization')
  @ApiPaginatedResponse(UsageOverviewRowResponse)
  @Get('usage')
  overview(
    @Query() query: UsageOverviewQueryDto,
  ): Promise<Paginated<UsageOverviewRowResponse>> {
    return this.usage.overview(query);
  }

  /**
   * Get the quota usage of an organization
   *
   * @remarks
   * Organization administrators only. Returns the current month's credits and
   * storage against the organization's limits, whether quotas are enforced,
   * and the most recent credit entries with the users who spent them.
   */
  @Get(':slug/usage')
  one(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<OrganizationUsageResponse> {
    return this.usage.usage(auth.principal, slug);
  }

  /**
   * Change the quota of an organization
   *
   * @remarks
   * Requires `judge.edit_all_organization`. Sets the monthly credits cap, the
   * storage cap in bytes, or the unlimited flag; `null` clears a cap so the
   * site default applies again, and omitted fields stay as they are. The
   * change is logged. Returns the updated usage.
   */
  @RequirePermission('judge.edit_all_organization')
  @Patch(':slug/quota')
  updateQuota(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body(
      new RefuseNullFieldsPipe([
        'quotaMonthlyCredits',
        'quotaStorageBytes',
        'quotaUnlimited',
      ]),
    )
    body: UpdateQuotaDto,
  ): Promise<OrganizationUsageResponse> {
    return this.usage.updateQuota(auth.principal, slug, body);
  }
}
