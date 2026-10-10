import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import {
  OrganizationProblemListQueryDto,
  OrganizationProblemParamsDto,
  SetProblemTagsDto,
} from './dto/organization-problem.dto';
import { OrganizationProblemResponse } from './dto/organization-problem.response';
import { OrganizationProblemsService } from './organization-problems.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationProblemsController {
  constructor(private readonly problems: OrganizationProblemsService) {}

  /**
   * List the problems of an organization
   *
   * @remarks
   * Members and administrators only. Returns the organization's problems that
   * the viewer could already see, with the organization's tags and archive
   * flag. Archived ones are hidden unless `archived` is `true` or `all`.
   * Filter by `tag` (an unknown tag matches nothing) and `q` (code or name
   * substring). Paged with `page` and `pageSize` (default 50, at most 100).
   */
  @ApiPaginatedResponse(OrganizationProblemResponse)
  @Get(':slug/problems')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: OrganizationProblemListQueryDto,
  ): Promise<Paginated<OrganizationProblemResponse>> {
    return this.problems.list(auth.principal, slug, query);
  }

  /**
   * Set the tags of an organization problem
   *
   * @remarks
   * Organization administrators only. Replaces the problem's tags with
   * `tagIds` (at most 20, all must belong to the organization; 400
   * `unknown_tag` otherwise). Fails with 404 `not_found` if the problem does
   * not list the organization.
   */
  @Put(':slug/problems/:code/tags')
  setTags(
    @CurrentAuth() auth: AuthContext,
    @Param() target: OrganizationProblemParamsDto,
    @Body() body: SetProblemTagsDto,
  ): Promise<OrganizationProblemResponse> {
    return this.problems.setTags(auth.principal, target, body);
  }

  /**
   * Archive a problem in an organization
   *
   * @remarks
   * Organization administrators only. Hides the problem from the
   * organization's problem list by default; the problem itself is not changed.
   * Returns 204, or 404 `not_found` if the problem does not list the
   * organization.
   */
  @Post(':slug/problems/:code/archive')
  @HttpCode(204)
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param() target: OrganizationProblemParamsDto,
  ): Promise<void> {
    return this.problems.setArchived(auth.principal, target, true);
  }

  /**
   * Unarchive a problem in an organization
   *
   * @remarks
   * Organization administrators only. Shows an archived problem in the
   * organization's problem list again. Returns 204, or 404 `not_found` if the
   * problem does not list the organization.
   */
  @Delete(':slug/problems/:code/archive')
  @HttpCode(204)
  unarchive(
    @CurrentAuth() auth: AuthContext,
    @Param() target: OrganizationProblemParamsDto,
  ): Promise<void> {
    return this.problems.setArchived(auth.principal, target, false);
  }
}
