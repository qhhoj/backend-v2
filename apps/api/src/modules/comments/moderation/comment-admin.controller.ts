import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { CommentAdminService } from './comment-admin.service';
import { CommentModerationService } from './comment-moderation.service';
import {
  AdminCommentItemResponse,
  AdminCommentQueryDto,
} from './dto/admin-comment.dto';
import {
  BulkHideCommentsDto,
  BulkHideOutcomeResponse,
} from './dto/bulk-hide-comments.dto';

@RequirePermission('judge.change_comment')
@ApiTags('Comments')
@Controller('api/internal/admin/comments')
export class CommentAdminController {
  constructor(
    private readonly admin: CommentAdminService,
    private readonly moderation: CommentModerationService,
  ) {}

  /**
   * Search every comment
   *
   * @remarks
   * Requires `judge.change_comment`. Lists the comments of the whole site,
   * newest first, 30 per page, hidden ones included unless `state` narrows
   * it: filter by body text `search` (deleted comments left out), the
   * author's exact `author` username and the `pageType`. Comments on pages the moderator
   * cannot read are left out of the page. A body search that runs too long
   * fails with 422 `search_too_broad`.
   */
  @ApiPaginatedResponse(AdminCommentItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: AdminCommentQueryDto,
  ): Promise<Paginated<AdminCommentItemResponse>> {
    return this.admin.list(auth.principal, query);
  }

  /**
   * Hide or unhide many comments
   *
   * @remarks
   * Requires `judge.change_comment`. Applies the single-comment hide to each
   * of up to 50 `ids` in turn (each with its replies, its revision and the
   * moderator recorded) and recomputes the authors' contribution points once.
   * A refused comment does not stop the others: each id comes back with a
   * null `code`, or the error code that refused it (`not_found`,
   * `conflict` when its parent is hidden).
   */
  @Post('hidden')
  @HttpCode(200)
  setHidden(
    @CurrentAuth() auth: AuthContext,
    @Body() { ids, hidden }: BulkHideCommentsDto,
  ): Promise<BulkHideOutcomeResponse[]> {
    return this.moderation.setHiddenMany(auth.principal, ids, hidden);
  }
}
