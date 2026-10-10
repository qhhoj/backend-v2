import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationEditingController {
  constructor(private readonly editing: OrganizationEditingService) {}

  /**
   * Create an organization
   *
   * @remarks
   * Requires `judge.add_organization`. The creator is always an admin;
   * `adminIds` adds more. New organizations are unlisted until staff lists
   * them, and the short name defaults to the first 20 characters of the slug.
   * `isUnlisted`, `slots` and `shortName` need `judge.edit_all_organization`
   * (403 `forbidden`). A taken slug is 400 `validation_failed`. A user may
   * administer at most three organizations unless the actor holds
   * `judge.spam_organization`.
   */
  @Post()
  @RequirePermission('judge.add_organization')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    return this.editing.create(auth.principal, body);
  }

  /**
   * Edit an organization
   *
   * @remarks
   * Organization administrators only. Changes the fields sent (null is refused
   * for `slots`); `about` is re-rendered, `adminIds` is the whole new admin
   * list and must not be empty, and new admins are subject to the three-
   * organization cap. Staff fields `isUnlisted`, `slots` and `shortName` need
   * `judge.edit_all_organization`. A slug that is taken is 400
   * `validation_failed`.
   */
  @Patch(':slug')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body(new RefuseNullFieldsPipe(['slots'])) body: UpdateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    return this.editing.update(auth.principal, slug, body);
  }
}
