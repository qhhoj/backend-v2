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

@ApiTags('Contests')
@Controller('api/internal/contest-tags')
export class ContestTagsController {
  constructor(private readonly tags: ContestTagsService) {}

  /**
   * List contest tags
   *
   * @remarks
   * Returns the contest tag catalogue, public. Paged with `page` and
   * `pageSize`.
   */
  @Public()
  @ApiPaginatedResponse(ContestTagResponse)
  @Get()
  list(@Query() query: ContestTagListQueryDto): Paginated<ContestTagResponse> {
    return this.tags.list(query);
  }

  /**
   * Create a contest tag
   *
   * @remarks
   * Requires `judge.change_contest_tag`. Adds a tag to the catalogue; fails
   * with 409 `tag_limit` when the catalogue is full.
   */
  @RequirePermission('judge.change_contest_tag')
  @Post()
  create(@Body() body: CreateContestTagDto): Promise<ContestTagResponse> {
    return this.tags.create(body);
  }

  /**
   * Update a contest tag
   *
   * @remarks
   * Requires `judge.change_contest_tag`. Changes the tag's fields by slug;
   * null values are refused. Fails with 404 `not_found` for an unknown slug.
   */
  @RequirePermission('judge.change_contest_tag')
  @Patch(':slug')
  update(
    @Param() { slug }: ContestTagSlugParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateContestTagDto,
  ): Promise<ContestTagResponse> {
    return this.tags.update(slug, body);
  }

  /**
   * Delete a contest tag
   *
   * @remarks
   * Requires `judge.change_contest_tag`. Deletes the tag; contests that carry
   * it keep the slug and show a neutral chip. Returns 204, or 404 `not_found`
   * for an unknown slug.
   */
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
