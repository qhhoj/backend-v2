import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import type { OrganizationDetailResponse } from '../core/dto/organization.response';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization-edit.dto';
import { OrganizationEditingService } from './organization-editing.service';

@Controller('api/internal/organizations')
export class OrganizationEditingController {
  constructor(private readonly editing: OrganizationEditingService) {}

  @Post()
  @RequirePermission('judge.add_organization')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    return this.editing.create(auth.principal, body);
  }

  @Patch(':slug')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body(new RefuseNullFieldsPipe(['slots'])) body: UpdateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    return this.editing.update(auth.principal, slug, body);
  }
}
