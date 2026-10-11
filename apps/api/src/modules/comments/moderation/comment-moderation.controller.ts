import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
  CommentPageQueryDto,
} from '../core/dto/comment-params.dto';
import { CommentPageLinkResponse } from '../core/dto/comment.response';
import type { CommentDetailResponse } from '../core/dto/comment.response';
import { CommentModerationService } from './comment-moderation.service';
import type { CommentVoteEntryResponse } from './dto/comment-vote-entry.response';
import { HideCommentDto } from './dto/hide-comment.dto';

@RequirePermission('judge.change_comment')
@ApiTags('Comments')
@Controller('api/internal/comments')
export class CommentModerationController {
  constructor(private readonly moderation: CommentModerationService) {}

  /**
   * Hide or unhide a comment
   *
   * @remarks
   * Requires `judge.change_comment`. Hides the comment together with its
   * replies, or restores what that comment had hidden, and recomputes the
   * authors' contribution points; each hide and unhide is recorded with the
   * moderator (shown to moderators as `hiddenBy`). A comment under a hidden
   * parent cannot be unhidden alone (409 `conflict`). Returns the comment.
   */
  @Post(':id/hidden')
  @HttpCode(200)
  setHidden(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body() { hidden }: HideCommentDto,
  ): Promise<CommentDetailResponse> {
    return this.moderation.setHidden(auth.principal, id, hidden);
  }

  /**
   * List who voted on a comment
   *
   * @remarks
   * Requires `judge.change_comment`. Returns each voter with their score on
   * the comment.
   */
  @Get(':id/votes')
  votes(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentVoteEntryResponse[]> {
    return this.moderation.votesOf(auth.principal, id);
  }

  /**
   * List the pages with locked comments
   *
   * @remarks
   * Requires `judge.change_comment`. The pages whose comments are locked, the
   * newest lock first, 50 per page. Pages the moderator cannot read are left
   * out of the page (still counted in `total`).
   */
  @ApiPaginatedResponse(CommentPageLinkResponse)
  @Get('locks')
  lockedPages(
    @CurrentAuth() auth: AuthContext,
    @Query() { page }: CommentPageQueryDto,
  ): Promise<Paginated<CommentPageLinkResponse>> {
    return this.moderation.lockedPages(auth.principal, page);
  }

  /**
   * Lock the comments of a page
   *
   * @remarks
   * Requires `judge.change_comment`. Prevents new comments on the page;
   * holders of `judge.override_comment_lock` can still post. Returns 204.
   */
  @Put('pages/:type/:key/lock')
  @HttpCode(204)
  lock(
    @CurrentAuth() auth: AuthContext,
    @Param() { type, key }: CommentPageParamsDto,
  ): Promise<void> {
    return this.moderation.setLocked(auth.principal, type, key, true);
  }

  /**
   * Unlock the comments of a page
   *
   * @remarks
   * Requires `judge.change_comment`. Allows new comments on the page again.
   * Returns 204.
   */
  @Delete('pages/:type/:key/lock')
  @HttpCode(204)
  unlock(
    @CurrentAuth() auth: AuthContext,
    @Param() { type, key }: CommentPageParamsDto,
  ): Promise<void> {
    return this.moderation.setLocked(auth.principal, type, key, false);
  }
}
