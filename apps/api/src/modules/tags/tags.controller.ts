import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Search & tags')
@Controller('api/internal/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  /**
   * List tagged problems from other online judges
   *
   * @remarks
   * Public. Returns one page (`page` from 1, `pageSize` 1-100) of external
   * problems that users have tagged. Filter by `tag` (tag code), `search`
   * (substring of the code or name) and `judges` (`Atcoder`, `Codeforces`,
   * `CodeforcesGym`, `Kattis`, `VNOJ`; repeat the parameter).
   */
  @Public()
  @ApiPaginatedResponse(TagProblemListItemResponse)
  @Get()
  list(
    @Query() query: TagProblemListQueryDto,
  ): Promise<Paginated<TagProblemListItemResponse>> {
    return this.tags.list(query);
  }

  /**
   * List the available tags
   *
   * @remarks
   * Public. Returns the tag groups, sorted by code, each with its tags. Use the
   * tag codes with `GET /tags` and `POST /tags/{code}/assign`.
   */
  @Public()
  @Get('catalog')
  catalog(): TagCatalogResponse {
    return this.tags.catalog();
  }

  /**
   * Get a tagged problem
   *
   * @remarks
   * Public. Returns the problem, its tags and who assigned each one. A malformed
   * or unknown code is 404 `not_found`.
   */
  @Public()
  @Get(':code')
  detail(
    @Param() { code }: TagProblemCodeParamDto,
  ): Promise<TagProblemResponse> {
    return this.tags.detail(code);
  }

  /**
   * Add an external problem to the tag index
   *
   * @remarks
   * Needs a user who opted in to tagging and has `judge.add_tagproblem` or a
   * rating of at least 1900 (403 `forbidden`). `link` must be the URL of a
   * problem on a supported judge; the code and judge are derived from it (400
   * `validation_failed` otherwise) and `name` is the title. Responds 409
   * `conflict` when the problem already exists. Writes a revision and returns
   * the new entry.
   */
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateTagProblemDto,
  ): Promise<TagProblemResponse> {
    return this.tags.create(auth, body);
  }

  /**
   * Add tags to a tagged problem
   *
   * @remarks
   * Same permission as adding a problem. Adds the tags in `tagCodes` (1 to 50)
   * that the problem does not have yet, recording the caller as assigner; tags
   * already present are ignored. Responds 400 `validation_failed` for an unknown
   * tag code and 404 `not_found` for an unknown problem. Returns the updated
   * problem.
   */
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
