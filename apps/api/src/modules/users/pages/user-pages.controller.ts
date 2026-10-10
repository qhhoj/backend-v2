import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  ApiCursorResponse,
  ApiHasMoreResponse,
  ApiPaginatedResponse,
} from '@libs/common';
import type {
  CursorPageMetaResponse,
  HasMorePageMetaResponse,
  Paginated,
} from '@libs/common';
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
@ApiTags('Users')
@Controller('api/internal/users/:username')
export class UserPagesController {
  constructor(
    private readonly pages: UserPagesService,
    private readonly blogPosts: BlogPostsService,
    private readonly recentComments: RecentCommentsService,
  ) {}

  /**
   * Get a user's profile page
   *
   * @remarks
   * Public. Returns the public profile: points, performance points, solved count, contribution points, rating and ranks, a rating summary over the contests the viewer may read, listed organizations and the join date. Viewers holding `judge.ban_user` also get a `staff` block with the ban reason and activation state. 404 `not_found` for an unknown user.
   */
  @Get()
  page(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
  ): Promise<UserPageResponse> {
    return this.pages.page(optionalPrincipal(auth), username);
  }

  /**
   * List a user's contest ratings
   *
   * @remarks
   * Public. Returns the user's rating history, oldest first. Contest name and key are null when the viewer cannot see that contest; rating, rank and performance are null while the viewer may not read its scoreboard (hidden or frozen).
   */
  @Get('ratings')
  ratings(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
  ): Promise<RatingHistoryEntryResponse[]> {
    return this.pages.ratings(optionalPrincipal(auth), username);
  }

  /**
   * List problems a user has solved
   *
   * @remarks
   * Public. Returns the user's solved problems grouped by problem group, with points earned and total points per problem. Problems solved only in contests whose submissions are still hidden from the public are left out.
   */
  @Get('solved')
  solved(@Param() { username }: UsernameParamDto): Promise<SolvedResponse> {
    return this.pages.solved(username);
  }

  /**
   * Show how performance points are computed
   *
   * @remarks
   * Public. Returns the user's best submissions in order, each with its weight (percent of its points that count, falling by a fixed factor per rank) and scaled points. Uses `hasMore` paging; at most 300 entries are weighted. Cached for 10 minutes.
   */
  @ApiHasMoreResponse(PpEntryResponse)
  @Get('pp-breakdown')
  ppBreakdown(
    @Param() { username }: UsernameParamDto,
    @Query() query: PpBreakdownQueryDto,
  ): Promise<Paginated<PpEntryResponse, HasMorePageMetaResponse>> {
    return this.pages.ppBreakdown(username, query);
  }

  /**
   * Get a user's submission heatmap
   *
   * @remarks
   * Public. Returns submission counts per day for the last 365 days in the `timezone` asked for, defaulting to the viewer's profile zone and then UTC. Days without submissions are absent. Cached for 10 minutes per user and zone.
   */
  @Get('activity')
  activity(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityResponse> {
    return this.pages.activity(optionalPrincipal(auth), username, query);
  }

  /**
   * List a user's blog posts
   *
   * @remarks
   * Public. Returns a page of the user's blog posts that the viewer may read (the author tab of their profile); 404 `not_found` for an unknown user.
   */
  @ApiPaginatedResponse(PostListItemResponse)
  @Get('blog')
  blog(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
    @Query() { page }: PostPageQueryDto,
  ): Promise<Paginated<PostListItemResponse>> {
    return this.blogPosts.userPosts(optionalPrincipal(auth), username, page);
  }

  /**
   * List a user's recent comments
   *
   * @remarks
   * Requires `judge.view_all_user_comment`. Returns comments written by the user on pages the viewer may read, newest first, with cursor paging: pass `nextBefore` from the previous page as `before`. Errors: 401 `unauthorized` when signed out, 403 `forbidden` without the permission, 404 `not_found` for an unknown user.
   */
  @ApiCursorResponse(RecentCommentResponse)
  @Get('comments')
  comments(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { username }: UsernameParamDto,
    @Query() { before }: UserCommentsQueryDto,
  ): Promise<Paginated<RecentCommentResponse, CursorPageMetaResponse>> {
    return this.recentComments.userComments(
      optionalPrincipal(auth),
      username,
      before,
    );
  }
}
