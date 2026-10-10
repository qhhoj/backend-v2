import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import {
  CreateOrganizationRequestDto,
  DecideOrganizationRequestDto,
  OrganizationRequestListQueryDto,
  OrganizationRequestParamsDto,
} from './dto/organization-request.dto';
import { OrganizationRequestResponse } from './dto/organization-request.response';
import { OrganizationRequestsService } from './organization-requests.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationRequestsController {
  constructor(private readonly requests: OrganizationRequestsService) {}

  /**
   * Request to join a private organization
   *
   * @remarks
   * Files a join request with a `reason` for a private organization. At most
   * five requests per hour per user (429 `rate_limited`). Refusals are 409
   * `organization_open` (join directly instead), `already_member` and
   * `request_pending`, and 403 `locked_in_official_contest` during an official
   * contest.
   */
  @Post(':slug/requests')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: CreateOrganizationRequestDto,
  ): Promise<OrganizationRequestResponse> {
    return this.requests.create(auth.principal, slug, body);
  }

  /**
   * List the join requests of an organization
   *
   * @remarks
   * Organization administrators only. Returns one state at a time (`P` pending
   * by default, `A` approved or `R` rejected), newest first, 50 per page. 403
   * `forbidden` for non-administrators.
   */
  @ApiPaginatedResponse(OrganizationRequestResponse)
  @Get(':slug/requests')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: OrganizationRequestListQueryDto,
  ): Promise<Paginated<OrganizationRequestResponse>> {
    return this.requests.list(auth.principal, slug, query);
  }

  /**
   * Get a join request
   *
   * @remarks
   * Returns one request. Only its requester and organization administrators
   * may read it (403 `forbidden`); 404 `not_found` for a request that does not
   * belong to the organization.
   */
  @Get(':slug/requests/:id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug, id }: OrganizationRequestParamsDto,
  ): Promise<OrganizationRequestResponse> {
    return this.requests.detail(auth.principal, slug, id);
  }

  /**
   * Approve or reject a join request
   *
   * @remarks
   * Organization administrators only. Send `state` `A` to approve or `R` to
   * reject. Approval adds the user to the organization and refreshes its
   * points, unless the organization is full (409 `organization_full`); a
   * request that was already decided is 409 `request_already_decided`. The
   * requester is notified in their inbox.
   */
  @Post(':slug/requests/:id/decide')
  @HttpCode(200)
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug, id }: OrganizationRequestParamsDto,
    @Body() body: DecideOrganizationRequestDto,
  ): Promise<OrganizationRequestResponse> {
    return this.requests.decide(auth.principal, { slug, requestId: id }, body);
  }
}
