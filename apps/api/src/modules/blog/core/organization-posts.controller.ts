import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationSlugParamDto } from '../../organizations/core/dto/organization-params.dto';
import { BlogPostsService } from './blog-posts.service';
import { PostPageQueryDto } from './dto/post-list.dto';
import { PostListItemResponse } from './dto/post.response';

@Public()
@ApiTags('Blog')
@Controller('api/internal/organizations/:slug/posts')
export class OrganizationPostsController {
  constructor(private readonly posts: BlogPostsService) {}

  /**
   * List the posts of an organization
   *
   * @remarks
   * Public. Returns the organization's posts the viewer may see, pinned first
   * then newest first: members see published ones, administrators also drafts.
   * Viewers who may see none get an empty page. Paged with `page`. Fails with
   * 404 `not_found` for an unknown slug.
   */
  @ApiPaginatedResponse(PostListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { slug }: OrganizationSlugParamDto,
    @Query() { page }: PostPageQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.posts.organizationPosts(optionalPrincipal(auth), slug, page);
  }
}
