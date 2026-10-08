import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { BlogPostsService } from './blog-posts.service';
import { PostListQueryDto } from './dto/post-list.dto';
import { PostIdParamDto } from './dto/post-params.dto';
import { PostDetailResponse, PostListItemResponse } from './dto/post.response';

@Public()
@Controller('api/internal/posts')
export class BlogPostsController {
  constructor(private readonly posts: BlogPostsService) {}

  @ApiPaginatedResponse(PostListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext | undefined,
    @Query() query: PostListQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.posts.list(optionalPrincipal(auth), query);
  }

  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: PostIdParamDto,
  ): Promise<PostDetailResponse> {
    return this.posts.detail(optionalPrincipal(auth), id);
  }
}
