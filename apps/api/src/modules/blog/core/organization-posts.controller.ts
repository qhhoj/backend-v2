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
@Controller('api/internal/organizations/:slug/posts')
export class OrganizationPostsController {
  constructor(private readonly posts: BlogPostsService) {}

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
