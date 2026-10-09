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
import { CurrentAuth, Public, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, RefuseNullFieldsPipe } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ContestTagsService } from './contest-tags.service';
import {
  ContestTagListQueryDto,
  ContestTagSlugParamDto,
  CreateContestTagDto,
  UpdateContestTagDto,
} from './dto/contest-tag.dto';
import { ContestTagResponse } from './dto/contest-tag.response';

@Controller('api/internal/contest-tags')
export class ContestTagsController {
  constructor(private readonly tags: ContestTagsService) {}

  @Public()
  @ApiPaginatedResponse(ContestTagResponse)
  @Get()
  list(@Query() query: ContestTagListQueryDto): Paginated<ContestTagResponse> {
    return this.tags.list(query);
  }

  @RequirePermission('judge.change_contest_tag')
  @Post()
  create(@Body() body: CreateContestTagDto): Promise<ContestTagResponse> {
    return this.tags.create(body);
  }

  @RequirePermission('judge.change_contest_tag')
  @Patch(':slug')
  update(
    @Param() { slug }: ContestTagSlugParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateContestTagDto,
  ): Promise<ContestTagResponse> {
    return this.tags.update(slug, body);
  }

  @RequirePermission('judge.change_contest_tag')
  @Delete(':slug')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: ContestTagSlugParamDto,
  ): Promise<void> {
    return this.tags.remove(auth.principal, slug);
  }
}
