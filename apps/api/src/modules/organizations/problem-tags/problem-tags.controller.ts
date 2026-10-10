import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, RefuseNullFieldsPipe } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import {
  CreateProblemTagDto,
  ProblemTagListQueryDto,
  ProblemTagParamsDto,
  UpdateProblemTagDto,
} from './dto/problem-tag.dto';
import { ProblemTagResponse } from './dto/problem-tag.response';
import { ProblemTagsService } from './problem-tags.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class ProblemTagsController {
  constructor(private readonly tags: ProblemTagsService) {}

  /**
   * List the problem tags of an organization
   *
   * @remarks
   * Members and administrators only (403 `forbidden`). Returns the tags the
   * organization's admins use to label its problems. Paged with `page` and
   * `pageSize` (default 100).
   */
  @ApiPaginatedResponse(ProblemTagResponse)
  @Get(':slug/problem-tags')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: ProblemTagListQueryDto,
  ): Promise<Paginated<ProblemTagResponse>> {
    return this.tags.list(auth.principal, slug, query);
  }

  /**
   * Create a problem tag
   *
   * @remarks
   * Organization administrators only. Creates a tag with a slug, name and
   * optional colour. An organization may have at most 100 tags (409
   * `tag_limit_reached`) and slugs are unique within it (409 `slug_taken`).
   */
  @Post(':slug/problem-tags')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: CreateProblemTagDto,
  ): Promise<ProblemTagResponse> {
    return this.tags.create(auth.principal, slug, body);
  }

  /**
   * Update a problem tag
   *
   * @remarks
   * Organization administrators only. Changes the tag's name or colour; the
   * slug never changes and null values are refused. Fails with 404 `not_found`
   * for an unknown tag.
   */
  @Patch(':slug/problem-tags/:tagSlug')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ProblemTagParamsDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateProblemTagDto,
  ): Promise<ProblemTagResponse> {
    return this.tags.update(auth.principal, target, body);
  }

  /**
   * Delete a problem tag
   *
   * @remarks
   * Organization administrators only. Deletes the tag and removes it from the
   * organization's problems. Returns 204, or 404 `not_found` for an unknown
   * tag.
   */
  @Delete(':slug/problem-tags/:tagSlug')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ProblemTagParamsDto,
  ): Promise<void> {
    return this.tags.remove(auth.principal, target);
  }
}
