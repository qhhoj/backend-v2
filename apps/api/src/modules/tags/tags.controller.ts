import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { AssignTagsDto } from './dto/tag-assign.dto';
import { CreateTagProblemDto } from './dto/tag-problem-create.dto';
import { TagProblemListQueryDto } from './dto/tag-problem-list.dto';
import { TagProblemCodeParamDto } from './dto/tag-problem-params.dto';
import {
  TagCatalogResponse,
  TagProblemListItemResponse,
  TagProblemResponse,
} from './dto/tag.response';
import { TagsService } from './tags.service';

@Controller('api/internal/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Public()
  @ApiPaginatedResponse(TagProblemListItemResponse)
  @Get()
  list(
    @Query() query: TagProblemListQueryDto,
  ): Promise<Paginated<TagProblemListItemResponse>> {
    return this.tags.list(query);
  }

  @Public()
  @Get('catalog')
  catalog(): TagCatalogResponse {
    return this.tags.catalog();
  }

  @Public()
  @Get(':code')
  detail(
    @Param() { code }: TagProblemCodeParamDto,
  ): Promise<TagProblemResponse> {
    return this.tags.detail(code);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateTagProblemDto,
  ): Promise<TagProblemResponse> {
    return this.tags.create(auth, body);
  }

  @HttpCode(200)
  @Post(':code/assign')
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: TagProblemCodeParamDto,
    @Body() body: AssignTagsDto,
  ): Promise<TagProblemResponse> {
    return this.tags.assign(auth, code, body);
  }
}
