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
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import {
  CreateOrganizationRequestDto,
  DecideOrganizationRequestDto,
  OrganizationRequestListQueryDto,
  OrganizationRequestParamsDto,
} from './dto/organization-request.dto';
import type { OrganizationRequestResponse } from './dto/organization-request.response';
import { OrganizationRequestsService } from './organization-requests.service';

@Controller('api/internal/organizations')
export class OrganizationRequestsController {
  constructor(private readonly requests: OrganizationRequestsService) {}

  @Post(':slug/requests')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: CreateOrganizationRequestDto,
  ): Promise<OrganizationRequestResponse> {
    return this.requests.create(auth.principal, slug, body);
  }

  @Get(':slug/requests')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: OrganizationRequestListQueryDto,
  ): Promise<Paginated<OrganizationRequestResponse>> {
    return this.requests.list(auth.principal, slug, query);
  }

  @Get(':slug/requests/:id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug, id }: OrganizationRequestParamsDto,
  ): Promise<OrganizationRequestResponse> {
    return this.requests.detail(auth.principal, slug, id);
  }

  @Post(':slug/requests/:id/decide')
  @HttpCode(200)
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug, id }: OrganizationRequestParamsDto,
    @Body() body: DecideOrganizationRequestDto,
  ): Promise<OrganizationRequestResponse> {
    return this.requests.decide(auth.principal, slug, id, body);
  }
}
