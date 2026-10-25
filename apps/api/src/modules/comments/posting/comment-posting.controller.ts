import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
} from '../core/dto/comment-params.dto';
import type { CommentResponse } from '../core/dto/comment.response';
import { PageListQueryDto } from '../../site/admin/dto/site-admin-params.dto';
import { CommentPostingService } from './comment-posting.service';
import { CommentBodyDto, NewCommentDto } from './dto/comment-body.dto';
import type { CommentPreviewResponse } from './dto/comment-preview.response';
import type { CommentRevisionResponse } from './dto/comment-revision.response';

@ApiTags('Comments')
@Controller('api/internal/comments')
export class CommentPostingController {
  constructor(private readonly posting: CommentPostingService) {}

  /**
   * Post a comment
   *
   * @remarks
   * Adds a comment to a page, or a reply when `parentId` is given. Needs
   * enough solved problems and an unmuted account, a page that is not locked,
   * and a parent on the same page that is visible, not older than a year
   * (unless the caller holds `judge.change_comment`) and not nested too deep.
   * Limited to 10 comments per 5 minutes per user (429 `rate_limited`).
   * Markdown is rendered in safe mode; public comments are announced on
   * Discord.
   */
  @Post('pages/:type/:key')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { type, key }: CommentPageParamsDto,
    @Body() body: NewCommentDto,
  ): Promise<CommentResponse> {
    return this.posting.create(auth.principal, { type, key }, body);
  }

  /**
   * Preview a comment
   *
   * @remarks
   * Renders a comment body to HTML exactly as posting would (safe-mode
   * Markdown, same length rule: 400 `validation_failed` when blank or over
   * 8192 characters) without saving anything. Needs enough solved problems
   * and an unmuted account (403 `forbidden`). Limited to 30 previews per
   * minute per user (429 `rate_limited`).
   */
  @Post('preview')
  @HttpCode(200)
  async preview(
    @CurrentAuth() auth: AuthContext,
    @Body() { body }: CommentBodyDto,
  ): Promise<CommentPreviewResponse> {
    return { bodyHtml: await this.posting.preview(auth.principal, body) };
  }

  /**
   * Edit a comment
   *
   * @remarks
   * Changes the comment's body. Allowed for its author (not muted) and for
   * holders of `judge.change_comment`; a revision with the old text is kept.
   * Fails with 409 `conflict` if the comment changed meanwhile.
   */
  @Patch(':id')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body(new RefuseNullFieldsPipe()) { body }: CommentBodyDto,
  ): Promise<CommentResponse> {
    return this.posting.edit(auth.principal, id, body);
  }

  /**
   * Delete a comment
   *
   * @remarks
   * Allowed for its author and for holders of `judge.change_comment` (403
   * `forbidden` otherwise). The comment stays in its thread as a placeholder
   * (`deleted: true`, empty `bodyHtml`) so replies keep their context; it can
   * no longer be edited, voted on, replied to or reported, and its score
   * leaves the author's contribution. Its edit history becomes
   * moderator-only. Fails with 404 `not_found` when the comment is unknown,
   * unreadable or already deleted. Returns the placeholder.
   */
  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentResponse> {
    return this.posting.remove(auth.principal, id);
  }

  /**
   * List the edit history of a comment
   *
   * @remarks
   * Public. Returns the edits of a comment, newest first, 100 per `page`
   * (a full page may have a next one), with the time, the editor, and the
   * text before and after. A deleted comment also lists its deletion, as the
   * last text changed to empty. Hidden and deleted comments are only
   * available to holders of `judge.change_comment`.
   */
  @Public()
  @Get(':id/revisions')
  revisions(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
    @Query() { page }: PageListQueryDto,
  ): Promise<CommentRevisionResponse[]> {
    return this.posting.revisionsOf(optionalPrincipal(auth), id, page);
  }
}
