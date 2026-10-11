import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { PostPageQueryDto } from '../core/dto/post-list.dto';
import { PostListItemResponse } from '../core/dto/post.response';
import { BlogDraftsService } from './blog-drafts.service';
import { PostComposeOptionsResponse } from './dto/post-compose.response';

@ApiTags('Blog')
@Controller('api/internal/posts')
export class BlogDraftsController {
  constructor(private readonly drafts: BlogDraftsService) {}

  /**
   * List my drafts
   *
   * @remarks
   * The caller's own posts that are not public yet: drafts and posts
   * scheduled for later, personal and organization ones, limited to those the
   * caller may still edit. Newest publish time first. Paged with `page`.
   */
  @ApiPaginatedResponse(PostListItemResponse)
  @Get('drafts')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() { page }: PostPageQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.drafts.drafts(auth.principal, page);
  }

  /**
   * Get where I may post
   *
   * @remarks
   * Whether the caller may write a personal post (unmuted, with
   * `minSolvedProblems` solved problems) and the organizations they may post
   * for (their admin, unmuted, with `judge.edit_organization_post`). Creating
   * a post applies the same rules.
   */
  @Get('compose-options')
  composeOptions(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PostComposeOptionsResponse> {
    return this.drafts.composeOptions(auth.principal);
  }
}
