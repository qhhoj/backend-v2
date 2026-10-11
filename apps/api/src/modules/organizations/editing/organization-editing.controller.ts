import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  ApiPaginatedResponse,
  RefuseNullFieldsPipe,
  RenderPreviewResponse,
} from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import type { OrganizationDetailResponse } from '../core/dto/organization.response';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization-edit.dto';
import { OrganizationRevisionResponse } from './dto/organization-revision.response';
import {
  OrganizationAboutPreviewDto,
  OrganizationHistoryQueryDto,
} from './dto/organization-tools.dto';
import { OrganizationEditingService } from './organization-editing.service';
import { OrganizationToolsService } from './organization-tools.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationEditingController {
  constructor(
    private readonly editing: OrganizationEditingService,
    private readonly tools: OrganizationToolsService,
  ) {}

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
   * `judge.spam_organization`: issue code `admin_cap` on `adminIds`, a 403
   * for the creator and a 400 for another admin. Recorded in the history.
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
   * `validation_failed`; the admin cap is issue code `admin_cap`. Changed
   * fields are recorded in the history.
   */
  @Patch(':slug')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body(new RefuseNullFieldsPipe(['slots'])) body: UpdateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    return this.editing.update(auth.principal, slug, body);
  }

  /**
   * Preview an organization's about text
   *
   * @remarks
   * Renders and sanitises the Markdown exactly as saving `about` would. For
   * holders of `judge.add_organization` or `judge.edit_all_organization` and
   * administrators of any organization (403 `forbidden` otherwise). Limited
   * to 60 previews per user per minute (429 `rate_limited`).
   */
  @Post('render-preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() { markdown }: OrganizationAboutPreviewDto,
  ): Promise<RenderPreviewResponse> {
    return this.tools.preview(auth.principal, markdown);
  }

  /**
   * List an organization's change history
   *
   * @remarks
   * Organization administrators only (403 `forbidden`). Returns the
   * recorded creates, edits and member removals, newest first, 20 per page,
   * each with its editor and the fields before and after.
   */
  @ApiPaginatedResponse(OrganizationRevisionResponse)
  @Get(':slug/revisions')
  history(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() { page }: OrganizationHistoryQueryDto,
  ): Promise<Paginated<OrganizationRevisionResponse>> {
    return this.tools.history(auth.principal, slug, page);
  }

  /**
   * Recalculate an organization's points and member count
   *
   * @remarks
   * Requires `judge.edit_all_organization`. Queues the worker's recompute of
   * the organization's performance points and member count (they are
   * otherwise refreshed only after membership or points changes) and returns
   * 204. 404 `not_found` for an unknown slug.
   */
  @Post(':slug/recalculate')
  @HttpCode(204)
  @RequirePermission('judge.edit_all_organization')
  recalculate(@Param() { slug }: OrganizationSlugParamDto): Promise<void> {
    return this.tools.recalculate(slug);
  }
}
