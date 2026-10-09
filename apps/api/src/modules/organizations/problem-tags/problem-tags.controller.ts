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

@Controller('api/internal/organizations')
export class ProblemTagsController {
  constructor(private readonly tags: ProblemTagsService) {}

  @ApiPaginatedResponse(ProblemTagResponse)
  @Get(':slug/problem-tags')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() query: ProblemTagListQueryDto,
  ): Promise<Paginated<ProblemTagResponse>> {
    return this.tags.list(auth.principal, slug, query);
  }

  @Post(':slug/problem-tags')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: CreateProblemTagDto,
  ): Promise<ProblemTagResponse> {
    return this.tags.create(auth.principal, slug, body);
  }

  @Patch(':slug/problem-tags/:tagSlug')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ProblemTagParamsDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateProblemTagDto,
  ): Promise<ProblemTagResponse> {
    return this.tags.update(auth.principal, target, body);
  }

  @Delete(':slug/problem-tags/:tagSlug')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ProblemTagParamsDto,
  ): Promise<void> {
    return this.tags.remove(auth.principal, target);
  }
}
