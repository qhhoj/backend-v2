import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { PostModerationQueryDto } from './dto/blog-moderation.dto';
import { BlogModerationService } from './blog-moderation.service';
import { PostListItemResponse } from '../core/dto/post.response';

@RequirePermission('judge.edit_all_post')
@ApiTags('Blog')
@Controller('api/internal/admin/posts')
export class BlogModerationController {
  constructor(private readonly moderation: BlogModerationService) {}

  /**
   * List posts awaiting moderation
   *
   * @remarks
   * Requires `judge.edit_all_post`. Returns posts by `state`: `hidden` (every
   * draft, personal or organization), `scheduled` (visible posts whose
   * publish time is still ahead), `organization` (every organization post) or
   * `any` (every post), newest first. `search` keeps posts whose title contains it
   * or with an author of that exact username; `organization` (a slug) keeps
   * that organization's posts. Paged with `page`.
   */
  @ApiPaginatedResponse(PostListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: PostModerationQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.moderation.list(auth.principal, query);
  }
}
