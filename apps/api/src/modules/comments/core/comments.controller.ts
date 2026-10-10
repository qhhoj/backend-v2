import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CommentsService } from './comments.service';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
  CommentPageQueryDto,
} from './dto/comment-params.dto';
import type {
  CommentDetailResponse,
  CommentLocationResponse,
  CommentPageResponse,
} from './dto/comment.response';

@Public()
@ApiTags('Comments')
@Controller('api/internal/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /**
   * List the comments of a page
   *
   * @remarks
   * Public. Returns one page of threads (20 top-level comments with all their
   * replies) of a commentable page, addressed by `type` (problem, editorial,
   * contest, blog or tagProblem) and its natural `key` (problem code, contest
   * key, post id). Also reports the page's lock (`pageLocked`), whether it is
   * locked for the viewer (`locked`), and whether the viewer can comment
   * (`canComment`) or why not (`postBlock`: `signed_out`, `contest`,
   * `locked`, `muted`, or `needs_solved` with `solved` and `required`).
   * Hidden comments are returned only to holders of `judge.change_comment`,
   * flagged `hidden` with the moderator in `hiddenBy`; deleted comments stay
   * as placeholders (`deleted`, empty `bodyHtml`). Fails with 404
   * `not_found` when the page is unknown or unreadable, and 403 `forbidden`
   * while an official contest closes comments. Contest problem threads are
   * empty for contestants who are in the contest.
   */
  @Get('pages/:type/:key')
  page(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { type, key }: CommentPageParamsDto,
    @Query() { page }: CommentPageQueryDto,
  ): Promise<CommentPageResponse> {
    return this.comments.page(optionalPrincipal(auth), type, key, page);
  }

  /**
   * Locate a comment
   *
   * @remarks
   * Public. Returns the page a comment belongs to and the listing page number
   * (`?page=` of the page listing) holding its thread for this viewer, so a
   * `#comment-<id>` link can open the right page. Fails with 404 `not_found`
   * like getting the comment.
   */
  @Get(':id/location')
  locate(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentLocationResponse> {
    return this.comments.locate(optionalPrincipal(auth), id);
  }

  /**
   * Get a comment
   *
   * @remarks
   * Public. Returns one comment with the link to its page. Hidden comments are
   * only returned to holders of `judge.change_comment`. Fails with 404
   * `not_found` for malformed, unknown, hidden or unreadable comments.
   */
  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentDetailResponse> {
    return this.comments.detail(optionalPrincipal(auth), id);
  }
}
