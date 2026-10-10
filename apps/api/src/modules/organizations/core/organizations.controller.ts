import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
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
@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /**
   * List organizations
   *
   * @remarks
   * Returns one page of organizations the viewer may list. Unlisted
   * organizations appear only to their members, their admins and holders of
   * `judge.edit_all_organization`. `search` narrows by a case-insensitive
   * substring of name, short name or slug. Paged with `page` and `pageSize`
   * (default 100, at most 100). Anonymous callers may use it.
   */
  @ApiPaginatedResponse(OrganizationListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext | undefined,
    @Query() query: OrganizationListQueryDto,
  ): Promise<Paginated<OrganizationListItemResponse>> {
    return this.organizations.list(optionalPrincipal(auth), query);
  }

  /**
   * Get an organization by slug
   *
   * @remarks
   * Returns the organization's profile: name, rendered about text, admins,
   * member slots, and the viewer's own state (member, may administer, pending
   * join request). The raw `about` text is only returned to administrators.
   * Unlisted organizations are reachable by slug for anyone. Fails with 404
   * `not_found` for an unknown slug.
   */
  @Get(':slug')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<OrganizationDetailResponse> {
    return this.organizations.detail(optionalPrincipal(auth), slug);
  }

  /**
   * List the members of an organization
   *
   * @remarks
   * Returns the organization's members with their points, problem count and
   * rating, ranked by the chosen `sort` (`performancePoints` by default,
   * `points`, `problemCount` or `rating`; ties share a rank). Paged with
   * `page` and `pageSize` (default 100). Fails with 404 `not_found` for an
   * unknown slug.
   */
  @ApiPaginatedResponse(MemberResponse)
  @Get(':slug/members')
  members(
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: MemberListQueryDto,
  ): Promise<Paginated<MemberResponse>> {
    return this.organizations.membersOf(slug, query);
  }
}
