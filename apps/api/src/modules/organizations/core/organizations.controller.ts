import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import type { Paginated } from '@libs/common';
import { MemberResponse } from './dto/member.response';
import {
  MemberListQueryDto,
  OrganizationListQueryDto,
  OrganizationSlugParamDto,
} from './dto/organization-params.dto';
import {
  OrganizationDetailResponse,
  OrganizationListItemResponse,
} from './dto/organization.response';
import { OrganizationsService } from './organizations.service';

@Public()
@Controller('api/internal/organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext | undefined,
    @Query() query: OrganizationListQueryDto,
  ): Promise<Paginated<OrganizationListItemResponse>> {
    return this.organizations.list(optionalPrincipal(auth), query);
  }

  @Get(':slug')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<OrganizationDetailResponse> {
    return this.organizations.detail(optionalPrincipal(auth), slug);
  }

  @Get(':slug/members')
  members(
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: MemberListQueryDto,
  ): Promise<Paginated<MemberResponse>> {
    return this.organizations.membersOf(slug, query);
  }
}
