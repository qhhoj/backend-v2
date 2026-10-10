import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
} from '../core/dto/comment-params.dto';
import type { CommentResponse } from '../core/dto/comment.response';
import { CommentPostingService } from './comment-posting.service';
import { CommentBodyDto, NewCommentDto } from './dto/comment-body.dto';
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
   * List the edit history of a comment
   *
   * @remarks
   * Public. Returns every edit of a comment with the time, the editor, and the
   * text before and after. Hidden comments are only available to holders of
   * `judge.change_comment`.
   */
  @Public()
  @Get(':id/revisions')
  revisions(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentRevisionResponse[]> {
    return this.posting.revisionsOf(optionalPrincipal(auth), id);
  }
}
