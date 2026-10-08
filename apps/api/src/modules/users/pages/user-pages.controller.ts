import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { RecentCommentResponse } from '../../comments/core/dto/recent-comment.response';
import { RecentCommentsService } from '../../comments/core/recent-comments.service';
import { BlogPostsService } from '../../blog/core/blog-posts.service';
import { PostPageQueryDto } from '../../blog/core/dto/post-list.dto';
import { PostListItemResponse } from '../../blog/core/dto/post.response';
import { UsernameParamDto } from '../core/dto/username-params.dto';
import {
  ActivityQueryDto,
  PpBreakdownQueryDto,
  UserCommentsQueryDto,
} from './dto/user-page.dto';
import {
  ActivityResponse,
  PpEntryResponse,
  RatingHistoryEntryResponse,
  SolvedResponse,
  UserPageResponse,
} from './dto/user-page.response';
import { UserPagesService } from './user-pages.service';

@Public()
@Controller('api/internal/users/:username')
export class UserPagesController {
  constructor(
    private readonly pages: UserPagesService,
    private readonly blogPosts: BlogPostsService,
    private readonly recentComments: RecentCommentsService,
  ) {}

  @Get()
  page(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
  ): Promise<UserPageResponse> {
    return this.pages.page(optionalPrincipal(auth), username);
  }

  @Get('ratings')
  ratings(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
  ): Promise<RatingHistoryEntryResponse[]> {
    return this.pages.ratings(optionalPrincipal(auth), username);
  }

  @Get('solved')
  solved(@Param() { username }: UsernameParamDto): Promise<SolvedResponse> {
    return this.pages.solved(username);
  }

  @ApiPaginatedResponse(PpEntryResponse)
  @Get('pp-breakdown')
  ppBreakdown(
    @Param() { username }: UsernameParamDto,
    @Query() query: PpBreakdownQueryDto,
  ): Promise<Paginated<PpEntryResponse>> {
    return this.pages.ppBreakdown(username, query);
  }

  @Get('activity')
  activity(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityResponse> {
    return this.pages.activity(optionalPrincipal(auth), username, query);
  }

  @ApiPaginatedResponse(PostListItemResponse)
  @Get('blog')
  blog(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
    @Query() { page }: PostPageQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.blogPosts.userPosts(optionalPrincipal(auth), username, page);
  }

  @ApiPaginatedResponse(RecentCommentResponse)
  @Get('comments')
  comments(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
    @Query() { before }: UserCommentsQueryDto,
  ): Promise<Paginated<RecentCommentResponse>> {
    return this.recentComments.userComments(
      optionalPrincipal(auth),
      username,
      before,
    );
  }
}
