import { ApiTags } from '@nestjs/swagger';
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
@ApiTags('Blog')
@Controller('api/internal/posts')
export class BlogPostsController {
  constructor(private readonly posts: BlogPostsService) {}

  /**
   * List blog posts
   *
   * @remarks
   * Public. Returns published personal posts, newest first. `feed` is `global`
   * (default: posts marked global, pinned ones first) or `all` (every
   * published personal post). Organization posts never appear here; see the
   * organization posts endpoint. Paged with `page`.
   */
  @ApiPaginatedResponse(PostListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext | undefined,
    @Query() query: PostListQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.posts.list(optionalPrincipal(auth), query);
  }

  /**
   * Get a blog post
   *
   * @remarks
   * Public for published personal posts; organization posts need membership,
   * and drafts or scheduled posts need edit rights. Returns the rendered
   * content, the author and organization, vote totals and whether the viewer
   * can edit or delete. The raw `content` and `summary` are returned only to
   * those who can edit. Fails with 404 `not_found` for malformed, unknown and
   * invisible ids alike.
   */
  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: PostIdParamDto,
  ): Promise<PostDetailResponse> {
    return this.posts.detail(optionalPrincipal(auth), id);
  }
}
