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

@Controller('api/internal/organizations')
export class OrganizationProblemsController {
  constructor(private readonly problems: OrganizationProblemsService) {}

  @ApiPaginatedResponse(OrganizationProblemResponse)
  @Get(':slug/problems')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: OrganizationProblemListQueryDto,
  ): Promise<Paginated<OrganizationProblemResponse>> {
    return this.problems.list(auth.principal, slug, query);
  }

  @Put(':slug/problems/:code/tags')
  setTags(
    @CurrentAuth() auth: AuthContext,
    @Param() target: OrganizationProblemParamsDto,
    @Body() body: SetProblemTagsDto,
  ): Promise<OrganizationProblemResponse> {
    return this.problems.setTags(auth.principal, target, body);
  }

  @Post(':slug/problems/:code/archive')
  @HttpCode(204)
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param() target: OrganizationProblemParamsDto,
  ): Promise<void> {
    return this.problems.setArchived(auth.principal, target, true);
  }

  @Delete(':slug/problems/:code/archive')
  @HttpCode(204)
  unarchive(
    @CurrentAuth() auth: AuthContext,
    @Param() target: OrganizationProblemParamsDto,
  ): Promise<void> {
    return this.problems.setArchived(auth.principal, target, false);
  }
}
