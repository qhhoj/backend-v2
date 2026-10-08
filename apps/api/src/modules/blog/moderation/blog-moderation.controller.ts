import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { PostModerationQueryDto } from './dto/blog-moderation.dto';
import { BlogModerationService } from './blog-moderation.service';
import { PostListItemResponse } from '../core/dto/post.response';

@RequirePermission('judge.edit_all_post')
@Controller('api/internal/admin/posts')
export class BlogModerationController {
  constructor(private readonly moderation: BlogModerationService) {}

  @ApiPaginatedResponse(PostListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: PostModerationQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.moderation.list(auth.principal, query);
  }
}
